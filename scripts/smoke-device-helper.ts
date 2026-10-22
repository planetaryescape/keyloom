#!/usr/bin/env bun
// Runs the real installer against a file:// release mirror, then the installed binary outside the repo.
// No server, credentials, Docker or device discovery. Usage: bun scripts/smoke-device-helper.ts <binary> [failure-code]
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { NATIVE_CAPABILITIES } from "../src/firmware/toolchain/device-helper/transport-protocol.ts";
import pkg from "../package.json" with { type: "json" };

const source = process.argv[2];
if (!source) throw new Error("pass the native compiled binary");
const binary = resolve(source);
const linuxCandidate = process.argv[3] === "--native-linux";
if (linuxCandidate && process.platform !== "linux") throw new Error("Linux candidate smoke requires a Linux host");
const expectedFailure = linuxCandidate ? undefined : process.argv[3];
const scratch = mkdtempSync(join(tmpdir(), "keyloom-device-installed-"));
const cache = join(scratch, "cache space é");
const installed = join(scratch, "bin/keyloom");
const env = { PATH: "/usr/bin:/bin", HOME: scratch, XDG_CACHE_HOME: cache };
const helperReport = z.object({ ok: z.boolean(), checks: z.array(z.object({
  ok: z.boolean(), detail: z.string(), deviceHelper: z.object({ available: z.boolean(), hostVersion: z.string(), helperVersion: z.string().optional(), target: z.string(), protocol: z.literal(1), capabilities: z.array(z.string()), helperSha256: z.string().optional(), code: z.string().optional() }),
})) });
async function run(cmd: string[], expected = 0) {
  const child = Bun.spawn(cmd, { cwd: scratch, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== expected) throw new Error(`exit ${code}, expected ${expected}: ${cmd[0]} ${cmd[1]}: ${stderr} ${stdout}`);
  return stdout;
}
async function doctor(expected = 0) {
  return helperReport.parse(JSON.parse(await run([installed, "--data-dir", join(scratch, "data"), "doctor", "--device-helper-only"], expected)));
}
try {
  const mirror = join(scratch, "mirror/download", `v${pkg.version}`);
  mkdirSync(mirror, { recursive: true });
  const asset = `keyloom-${process.platform}-${process.arch}`;
  cpSync(binary, join(mirror, asset));
  writeFileSync(join(mirror, "SHA256SUMS"), `${createHash("sha256").update(await Bun.file(binary).bytes()).digest("hex")}  ${asset}\n`);
  const installer = Bun.spawn(["/bin/sh", resolve("install.sh"), "--version", `v${pkg.version}`], {
    cwd: scratch, env: { ...env, KEYLOOM_INSTALL_DIR: join(scratch, "bin"), KEYLOOM_DOWNLOAD_BASE: `file://${join(scratch, "mirror")}` }, stdout: "pipe", stderr: "pipe",
  });
  const installOutput = await new Response(installer.stdout).text();
  const installError = await new Response(installer.stderr).text();
  if (await installer.exited !== 0) throw new Error(installError);
  console.log(installOutput.trim());
  if ((await run([installed, "--version"])).trim() !== pkg.version) throw new Error("wrong installed version");
  if (expectedFailure) {
    const failure = await doctor(1);
    if (failure.checks[0]?.deviceHelper.code !== expectedFailure) throw new Error("wrong failure diagnostic");
    console.log(JSON.stringify({ refused: expectedFailure, report: failure }));
  } else {
    const start = performance.now();
    const reports = await Promise.all(Array.from({ length: 8 }, () => doctor()));
    const coldConcurrentMs = performance.now() - start;
    const info = reports[0]?.checks[0]?.deviceHelper;
    if (!info?.available || !info.helperSha256 || info.helperVersion !== pkg.version || reports.some((r) => !r.ok || JSON.stringify(r.checks[0]?.deviceHelper.capabilities) !== JSON.stringify(linuxCandidate || (process.platform === "darwin" && process.arch === "arm64") ? NATIVE_CAPABILITIES : []))) throw new Error("invalid installed pair");
    if (linuxCandidate && !reports[0]?.checks[0]?.detail.includes("native Linux candidate; hardware acceptance pending")) throw new Error("Linux candidate doctor must retain the hardware gate");
    console.log(JSON.stringify({ coldConcurrentMs, children: reports.length, manifest: info }));
    const executable = join(cache, "keyloom/device-helper", pkg.version, info.target, info.helperSha256, "keyloom-device");
    const helperHash = createHash("sha256").update(await Bun.file(executable).bytes()).digest("hex");
    if (helperHash !== info.helperSha256) throw new Error("extraction hash differs");
    if (process.platform === "darwin") await run(["/usr/bin/codesign", "--verify", "--strict", executable]);
    writeFileSync(executable, "deliberately corrupt isolated scratch helper");
    chmodSync(executable, 0o700);
    const corrupt = await doctor(1);
    if (corrupt.checks[0]?.deviceHelper.code !== "integrity_error") throw new Error("corrupt cache was not refused");
    console.log(JSON.stringify({ corruptRefused: corrupt }));
  }
  // Neither a broken helper nor a failed check may stop ordinary import/layout use.
  const fixture = join(scratch, "layout-fixture");
  cpSync(resolve("test/fixtures/oryx/synchronized"), fixture, { recursive: true });
  await run([installed, "--data-dir", join(scratch, "import-data"), "import", "--board", "zsa/moonlander", fixture]);
  await run([installed, "--data-dir", join(scratch, "import-data"), "layout", "list"]);
  console.log(JSON.stringify({ importAfterFailure: "passed", nodeModulesOrRustOnRuntimePath: false, installedBinary: basename(binary), scratch }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
