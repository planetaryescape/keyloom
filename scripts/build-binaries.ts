#!/usr/bin/env bun
// Native helper must be built/signed before embedding. Cross builds require prebuilt target helpers.
//   bun scripts/build-binaries.ts --target bun-darwin-arm64
//   bun scripts/build-binaries.ts --target bun-darwin-arm64 --helper /absolute/signed/keyloom-device
//   bun scripts/build-binaries.ts --helper-dir dist/helpers  # <triple>/keyloom-device for all targets
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { HID_CAPABILITIES, NATIVE_CAPABILITIES, SERIAL_CAPABILITIES } from "../src/firmware/toolchain/device-helper/transport-protocol.ts";

const RELEASE_TARGETS = {
  "bun-darwin-arm64": { name: "keyloom-darwin-arm64", rust: "aarch64-apple-darwin", platform: "darwin", arch: "arm64" },
  "bun-darwin-x64": { name: "keyloom-darwin-x64", rust: "x86_64-apple-darwin", platform: "darwin", arch: "x64" },
  "bun-linux-x64": { name: "keyloom-linux-x64", rust: "x86_64-unknown-linux-musl", platform: "linux", arch: "x64" },
} as const;
type BunTarget = keyof typeof RELEASE_TARGETS;
const isBunTarget = (value: string): value is BunTarget => Object.hasOwn(RELEASE_TARGETS, value);

function options(argv: string[]) {
  const targets: BunTarget[] = [];
  let entry = "src/cli/main.ts";
  let helper: string | undefined;
  let helperDir: string | undefined;
  let outDir = "dist";
  let backend: "legacy" | "native" | "native-hid" | "native-serial" | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === "--target" && isBunTarget(value)) targets.push(value);
    else if (arg === "--entry") entry = value;
    else if (arg === "--helper") helper = value;
    else if (arg === "--helper-dir") helperDir = value;
    else if (arg === "--out-dir") outDir = value;
    else if (arg === "--device-backend" && (value === "legacy" || value === "native" || value === "native-hid" || value === "native-serial")) backend = value;
    else throw new Error(`invalid option: ${arg}; targets: ${Object.keys(RELEASE_TARGETS).join(", ")}`);
  }
  const selected = targets.length ? targets : Object.keys(RELEASE_TARGETS).filter(isBunTarget);
  if (helper && (selected.length !== 1 || helperDir)) throw new Error("--helper requires exactly one --target and no --helper-dir");
  if (backend !== undefined && resolve(outDir) === resolve("dist")) {
    throw new Error("an explicit --device-backend requires a separate --out-dir");
  }
  if (backend !== undefined && backend !== "legacy" && selected.some((target) => RELEASE_TARGETS[target].platform !== "darwin")) {
    throw new Error(`${backend} requires a Mac target`);
  }
  return { targets: selected, entry, helper, helperDir, outDir, backend };
}

async function helperPath(target: BunTarget, backend: "legacy" | "native" | "native-hid" | "native-serial", helper?: string, helperDir?: string): Promise<string> {
  const spec = RELEASE_TARGETS[target];
  if (helper) return resolve(helper);
  if (helperDir) return resolve(helperDir, spec.rust, "keyloom-device");
  if (process.platform !== spec.platform || process.arch !== spec.arch)
    throw new Error(`cross build ${target} needs --helper-dir with native built/signed helpers, or --helper with one target`);
  const args = ["cargo", "build", "--locked", "--release", "--target", spec.rust];
  if (backend !== "legacy") args.push("--features", backend === "native" ? "native-macos" : backend);
  const build = Bun.spawn(args, {
    cwd: "native/device-helper", stdout: "inherit", stderr: "inherit",
  });
  if (await build.exited !== 0) throw new Error("helper build failed");
  const path = resolve("native/device-helper/target", spec.rust, "release/keyloom-device");
  if (process.platform === "darwin") {
    const sign = Bun.spawn(["/usr/bin/codesign", "--force", "--sign", "-", path], { stdout: "inherit", stderr: "inherit" });
    if (await sign.exited !== 0) throw new Error("helper ad-hoc signing failed");
  }
  return path;
}

type Backend = "legacy" | "native" | "native-hid" | "native-serial";
const EXPECTED_CAPABILITIES: Record<Backend, readonly string[]> = {
  legacy: [], native: NATIVE_CAPABILITIES, "native-hid": HID_CAPABILITIES, "native-serial": SERIAL_CAPABILITIES,
};

/** A prebuilt --helper skips the feature selection above, so refuse a pair the packaged client would reject at runtime. */
async function checkCapabilities(target: BunTarget, backend: Backend, helper: string): Promise<void> {
  const spec = RELEASE_TARGETS[target];
  // Only a helper for this host can run here; each release target builds on its own native runner.
  if (process.platform !== spec.platform || process.arch !== spec.arch) return;
  const child = Bun.spawn([helper, "--version"], { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(`${helper} --version failed`);
  const advertised = [...(JSON.parse(output) as { capabilities: string[] }).capabilities].sort();
  const expected = [...EXPECTED_CAPABILITIES[backend]].sort();
  if (advertised.join() !== expected.join()) {
    throw new Error(`${target} selects the ${backend} backend, which needs helper capabilities [${expected.join(", ")}], but ${helper} advertises [${advertised.join(", ")}]${backend === "native" ? "; build the helper with --features native-macos" : ""}`);
  }
}

const opts = options(process.argv.slice(2));
await mkdir(opts.outDir, { recursive: true });
const built: string[] = [];
for (const target of opts.targets) {
  const backend = opts.backend ?? (target === "bun-darwin-arm64" ? "native" : "legacy");
  const helper = await helperPath(target, backend, opts.helper, opts.helperDir);
  await checkCapabilities(target, backend, helper);
  const bytes = await Bun.file(helper).bytes();
  const manifest = {
    release: pkg.version, protocol: 1, target: RELEASE_TARGETS[target].rust,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const outfile = join(opts.outDir, RELEASE_TARGETS[target].name);
  const result = await Bun.build({
    entrypoints: [opts.entry], target: "bun", minify: true,
    compile: { target, outfile },
    plugins: [{
      name: "paired-device-helper",
      setup(build) {
        build.onLoad({ filter: /device-helper\/selection\.ts$/ }, () => ({
          loader: "ts", contents: `export function deviceBackend() { return ${JSON.stringify(backend)}; }`,
        }));
        build.onLoad({ filter: /device-helper\/packaged\.ts$/ }, () => ({
          loader: "ts",
          contents: `import asset from ${JSON.stringify(helper)} with { type: "file" };\nexport const packagedHelper = { asset, manifest: ${JSON.stringify(manifest)} };`,
        }));
      },
    }],
  });
  if (!result.success) throw new AggregateError(result.logs, `bun build failed for ${target}`);
  built.push(outfile);
  console.log(`built ${outfile}; helper ${manifest.sha256}`);
}
const checksums = await Promise.all(built.sort().map(async (file) =>
  `${createHash("sha256").update(await Bun.file(file).bytes()).digest("hex")}  ${basename(file)}`));
await writeFile(join(opts.outDir, "SHA256SUMS"), `${checksums.join("\n")}\n`);
