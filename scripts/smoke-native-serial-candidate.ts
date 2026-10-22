#!/usr/bin/env bun
// Installed real CLI/PTY journey, admitted ONLY after the embedded hash matches a compiled synthetic-serial-capture helper.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { transportIdentitySchema, SERIAL_CAPABILITIES, NATIVE_CAPABILITIES } from "../src/firmware/toolchain/device-helper/transport-protocol.ts";

const [source, helperSource] = process.argv.slice(2);
if (!source || !helperSource || process.platform !== "darwin") throw new Error("usage (macOS): bun scripts/smoke-native-serial-candidate.ts <compiled candidate> <synthetic-serial-capture helper>");
const binary = resolve(source), helper = resolve(helperSource);
const scratch = mkdtempSync(join(tmpdir(), "keyloom-native-serial-candidate-"));
const cache = join(scratch, "cache space é"), data = join(scratch, "data"), installed = join(scratch, "bin/keyloom");
const env = { PATH: "/usr/bin:/bin", HOME: scratch, XDG_CACHE_HOME: cache };
let passed = false;
async function run(cmd: string[], expected = 0, extra: Record<string, string> = {}, timeoutMs = 25_000) {
  const child = Bun.spawn(cmd, { cwd: scratch, env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== expected) throw new Error(`candidate smoke exit ${code}, expected ${expected}: ${stderr} ${stdout}`);
    if (expected === 2 && !stderr.includes("recording is incomplete")) throw new Error("analysis failed for a reason other than persisted interruption");
    return stdout;
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await child.exited; }
}
try {
  // --version and doctor are pure. No capture is attempted before both independent checks agree.
  const synthetic = transportIdentitySchema.extend({ syntheticBackend: z.literal(true), syntheticCapture: z.literal(true) }).parse(JSON.parse(await run([helper, "--version"])));
  if (JSON.stringify(synthetic.capabilities) !== JSON.stringify(SERIAL_CAPABILITIES) && JSON.stringify(synthetic.capabilities) !== JSON.stringify(NATIVE_CAPABILITIES)) throw new Error("expected serial or combined synthetic helper");
  if (synthetic.helperVersion !== pkg.version) throw new Error("synthetic release mismatch");
  const helperHash = createHash("sha256").update(await Bun.file(helper).bytes()).digest("hex");
  const mirror = join(scratch, "mirror/download", `v${pkg.version}`), asset = `keyloom-${process.platform}-${process.arch}`;
  mkdirSync(mirror, { recursive: true }); cpSync(binary, join(mirror, asset));
  writeFileSync(join(mirror, "SHA256SUMS"), `${createHash("sha256").update(await Bun.file(binary).bytes()).digest("hex")}  ${asset}\n`);
  await run(["/bin/sh", resolve("install.sh"), "--version", `v${pkg.version}`], 0, { KEYLOOM_INSTALL_DIR: join(scratch, "bin"), KEYLOOM_DOWNLOAD_BASE: `file://${join(scratch, "mirror")}` });
  const doctor = z.object({ ok: z.literal(true), checks: z.array(z.object({ deviceHelper: z.object({ available: z.literal(true), helperSha256: z.literal(helperHash), capabilities: z.array(z.string()).refine((caps) => JSON.stringify(caps) === JSON.stringify(synthetic.capabilities)) }) })) }).parse(JSON.parse(await run([installed, "--data-dir", data, "doctor", "--device-helper-only"])));
  if (doctor.checks.length !== 1) throw new Error("doctor must perform only the paired-helper check");
  const fixture = join(scratch, "glove80.keymap"); cpSync(resolve("test/fixtures/zmk/glove80-template/glove80.keymap"), fixture);
  const imported = z.object({ layout_id: z.string() }).parse(JSON.parse(await run([installed, "--data-dir", data, "import", "--board", "moergo/glove80", fixture])));
  // Three recordings at up to 15 s each plus bounded waits: stay above the driver's own budget so it reports and cleans up first.
  const journey = JSON.parse(await run(["/usr/bin/python3", resolve("scripts/smoke-native-serial-candidate.py"), installed, data, imported.layout_id, cache], 0, {}, 60_000));
  const sessionList = z.object({ sessions: z.array(z.object({ session_id: z.string(), incomplete: z.boolean(), warnings: z.array(z.string()) })) }).parse(JSON.parse(await run([installed, "--data-dir", data, "lab", "sessions"])));
  const incomplete = sessionList.sessions.filter((s) => s.warnings.some((w) => w.startsWith("Recording incomplete:")));
  if (sessionList.sessions.length !== 3 || incomplete.length !== 1) throw new Error("saved interruption did not survive reopening the CLI");
  await run([installed, "--data-dir", data, "lab", "analyse", incomplete[0]!.session_id], 2);
  console.log(JSON.stringify({ helperSha256: helperHash, runtimePath: env.PATH, doctor, journey, savedSessions: 3, incompleteSessions: 1, analysisRefused: true, scratch }));
  passed = true;
} finally {
  if (passed) rmSync(scratch, { recursive: true, force: true });
  else console.error(`candidate smoke scratch retained: ${scratch}`);
}
