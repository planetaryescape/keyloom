#!/usr/bin/env bun
// Lab uses the production CLI. Touch uses a separately installed test entry with production selectors.
import { mkdtempSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { NATIVE_CAPABILITIES, transportIdentitySchema } from "../src/firmware/toolchain/device-helper/transport-protocol.ts";

const [binary, helper, mode] = process.argv.slice(2);
if (mode !== undefined && mode !== "--touch-only") throw new Error("unknown smoke mode");
if (!binary || !helper || process.platform !== "darwin") throw new Error("usage (macOS): bun scripts/smoke-native-combined.ts <compiled native CLI> <synthetic-macos helper>");
async function run(args: string[], env?: Record<string, string>, cwd?: string) {
  const child = Bun.spawn(args, { ...(env ? { env } : {}), ...(cwd ? { cwd } : {}), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`${args[0]} exited ${code}: ${err}\n${out}`);
    return out;
  } finally { clearTimeout(timer); }
}
const identity = transportIdentitySchema.extend({ syntheticBackend: z.literal(true), syntheticCapture: z.literal(true) }).parse(JSON.parse(await run([resolve(helper), "--version"])));
if (JSON.stringify(identity.capabilities) !== JSON.stringify(NATIVE_CAPABILITIES)) throw new Error("combined synthetic helper required");
for (const transport of mode === "--touch-only" ? [] : ["hid", "serial"]) {
  console.log(await run([process.execPath, `scripts/smoke-native-${transport}-candidate.ts`, resolve(binary), resolve(helper)]));
}
const scratch = mkdtempSync(join(tmpdir(), "keyloom-combined-touch-"));
try {
  const target = `bun-darwin-${process.arch}`;
  await run([process.execPath, "scripts/build-binaries.ts", "--target", target, "--device-backend", "native", "--helper", resolve(helper), "--entry", "scripts/smoke-native-combined-entry.ts", "--out-dir", join(scratch, "built")]);
  const asset = `keyloom-darwin-${process.arch}`, built = join(scratch, "built", asset);
  const mirror = join(scratch, "mirror/download", `v${pkg.version}`);
  mkdirSync(mirror, { recursive: true }); cpSync(built, join(mirror, asset));
  writeFileSync(join(mirror, "SHA256SUMS"), `${createHash("sha256").update(await Bun.file(built).bytes()).digest("hex")}  ${asset}\n`);
  const env = { PATH: "/usr/bin:/bin", HOME: scratch, XDG_CACHE_HOME: join(scratch, "cache") };
  await run(["/bin/sh", resolve("install.sh"), "--version", `v${pkg.version}`], { ...env, KEYLOOM_INSTALL_DIR: join(scratch, "bin"), KEYLOOM_DOWNLOAD_BASE: `file://${join(scratch, "mirror")}` }, scratch);
  console.log(await run([join(scratch, "bin/keyloom"), "--synthetic-touch-smoke"], env, scratch));
} finally { rmSync(scratch, { recursive: true, force: true }); }
