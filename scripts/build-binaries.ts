#!/usr/bin/env bun
// Native helper must be built/signed before embedding. Cross builds require prebuilt target helpers.
//   bun scripts/build-binaries.ts --target bun-darwin-arm64
//   bun scripts/build-binaries.ts --target bun-darwin-arm64 --helper /absolute/signed/keyloom-device
//   bun scripts/build-binaries.ts --helper-dir dist/helpers  # <triple>/keyloom-device for all targets
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };

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
  let backend: "legacy" | "native-hid" = "legacy";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === "--target" && isBunTarget(value)) targets.push(value);
    else if (arg === "--entry") entry = value;
    else if (arg === "--helper") helper = value;
    else if (arg === "--helper-dir") helperDir = value;
    else if (arg === "--out-dir") outDir = value;
    else if (arg === "--device-backend" && (value === "legacy" || value === "native-hid")) backend = value;
    else throw new Error(`invalid option: ${arg}; targets: ${Object.keys(RELEASE_TARGETS).join(", ")}`);
  }
  const selected = targets.length ? targets : Object.keys(RELEASE_TARGETS).filter(isBunTarget);
  if (helper && (selected.length !== 1 || helperDir)) throw new Error("--helper requires exactly one --target and no --helper-dir");
  if (backend === "native-hid" && (resolve(outDir) === resolve("dist") || selected.some((target) => RELEASE_TARGETS[target].platform !== "darwin"))) {
    throw new Error("native-hid is an unadopted macOS candidate; select a Mac target and an explicit separate --out-dir");
  }
  return { targets: selected, entry, helper, helperDir, outDir, backend };
}

async function helperPath(target: BunTarget, backend: "legacy" | "native-hid", helper?: string, helperDir?: string): Promise<string> {
  const spec = RELEASE_TARGETS[target];
  if (helper) return resolve(helper);
  if (helperDir) return resolve(helperDir, spec.rust, "keyloom-device");
  if (process.platform !== spec.platform || process.arch !== spec.arch)
    throw new Error(`cross build ${target} needs --helper-dir with native built/signed helpers, or --helper with one target`);
  const args = ["cargo", "build", "--locked", "--release", "--target", spec.rust];
  if (backend === "native-hid") args.push("--features", "native-hid");
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

const opts = options(process.argv.slice(2));
await mkdir(opts.outDir, { recursive: true });
const built: string[] = [];
for (const target of opts.targets) {
  const helper = await helperPath(target, opts.backend, opts.helper, opts.helperDir);
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
          loader: "ts", contents: `export function deviceBackend() { return ${JSON.stringify(opts.backend)}; }`,
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
