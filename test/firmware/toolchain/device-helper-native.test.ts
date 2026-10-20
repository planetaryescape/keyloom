// Native CI explicitly supplies a diagnostics-only build. It contains no device backend or OS device APIs.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { diagnoseHelper } from "../../../src/firmware/toolchain/device-helper/client.ts";
import { manifestSchema } from "../../../src/firmware/toolchain/device-helper/extract.ts";
import { identitySchema } from "../../../src/firmware/toolchain/device-helper/protocol.ts";
import { tempDir } from "../../helpers/tmp.ts";
import pkg from "../../../package.json" with { type: "json" };

const binary = process.env.KEYLOOM_TEST_HELPER;
function launch(args = ["--stdio"]) {
  if (!binary) throw new Error("explicit diagnostics test binary required");
  return Bun.spawn([binary, ...args], { env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
}
async function identity() {
  const child = launch(["--version"]);
  const result = identitySchema.parse(JSON.parse(await new Response(child.stdout).text()));
  expect(await child.exited).toBe(0);
  expect(result.helperVersion).toBe(pkg.version);
  return result;
}
async function waitExit(child: ReturnType<typeof launch>, ms = 6500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([child.exited, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        let pidProbe = "present";
        try { process.kill(child.pid, 0); }
        catch (error) { pidProbe = error instanceof Error ? error.message : String(error); }
        const processState = process.platform === "win32" ? "not a Unix host" : Bun.spawnSync(
          ["/bin/ps", "-o", "pid=,ppid=,stat=,etime=,command=", "-p", String(child.pid)],
          { env: {}, timeout: 1000 },
        ).stdout.toString().trim();
        // Observe OS state before kill/drain: an unread pipe may delay a runtime exit notification.
        console.error(JSON.stringify({ nativeExitDeadline: { pid: child.pid, pidProbe, processState, exitCode: child.exitCode, signalCode: child.signalCode, budgetMs: ms } }));
        child.kill();
        reject(new Error("native helper did not exit"));
      }, ms);
    })]);
  } finally { clearTimeout(timer); }
}

describe.skipIf(!binary)("native diagnostics child contract", () => {
  test("exact identity, parallel hello/ping/shutdown and observed exits", async () => {
    const info = await identity();
    if (!binary) throw new Error("missing binary");
    const manifest = manifestSchema.parse({ release: info.helperVersion, protocol: 1, target: info.target, sha256: createHash("sha256").update(await Bun.file(binary).bytes()).digest("hex") });
    const results = await Promise.all(Array.from({ length: 8 }, () => diagnoseHelper(binary, manifest, () => launch())));
    expect(results.every((r) => r.capabilities.length === 0)).toBe(true);
  });

  test("EOF exits cleanly; incomplete/malformed/oversized frames exit fatally without echoing input", async () => {
    for (const [input, expected] of [["", 0], ["{", 1], ["secret-synthetic\n", 1], ["x".repeat(65537), 1]] as const) {
      const child = launch();
      child.stdin.write(input);
      void child.stdin.end();
      const stderr = new Response(child.stderr).text();
      expect(await waitExit(child)).toBe(expected);
      expect(await stderr).not.toContain("secret-synthetic");
    }
  });

  test("joined and fragmented frames preserve request ordering; unsupported device method has no capability", async () => {
    const info = await identity();
    const child = launch();
    const requests = [
      { v: 1, type: "request", id: "1", method: "hello", params: { protocol: 1, hostVersion: info.helperVersion, target: info.target } },
      { v: 1, type: "request", id: "2", method: "hid.open", params: { deviceRef: "synthetic" } },
      { v: 1, type: "request", id: "3", method: "shutdown", params: {} },
    ].map((r) => `${JSON.stringify(r)}\n`).join("");
    for (const byte of new TextEncoder().encode(requests)) child.stdin.write(Uint8Array.of(byte));
    void child.stdin.end();
    const output = new Response(child.stdout).text();
    expect(await waitExit(child)).toBe(0);
    const lines = (await output).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.id)).toEqual(["1", "2", "3"]);
    expect(lines[1].error).toEqual({ code: "unsupported", effect: "none", retry: "never" });
  });

  test("no heartbeat and blocked stdout both exit within the helper liveness budget", async () => {
    const quiet = launch();
    expect(await waitExit(quiet)).toBe(1);
    const info = await identity();
    const blocked = launch();
    blocked.stdin.write(`${JSON.stringify({ v: 1, type: "request", id: "1", method: "hello", params: { protocol: 1, hostVersion: info.helperVersion, target: info.target } })}\n`);
    const ping = Array.from({ length: 20000 }, (_, i) => JSON.stringify({ v: 1, type: "request", id: String(i + 2), method: "ping", params: {} })).join("\n");
    blocked.stdin.write(`${ping}\n`);
    // Deliberately do not read stdout or wait for a pipe flush.
    expect(await waitExit(blocked)).toBe(1);
  }, 15000);

  test("a killed Bun parent leaves no live helper after EOF/watchdog", async () => {
    const dir = tempDir();
    const pidFile = join(dir, "helper-pid");
    const parentFile = join(dir, "parent.ts");
    writeFileSync(parentFile, `const p = Bun.spawn([${JSON.stringify(binary)}, "--stdio"], {env:{},stdin:"pipe",stdout:"pipe",stderr:"pipe"}); await Bun.write(${JSON.stringify(pidFile)},String(p.pid)); setInterval(()=>{},1000);`);
    const parent = Bun.spawn([process.execPath, parentFile], { env: {}, stdout: "ignore", stderr: "ignore" });
    try {
      const until = Date.now() + 2000;
      while (!(await Bun.file(pidFile).exists()) && Date.now() < until) await Bun.sleep(10);
      const pid = Number(await Bun.file(pidFile).text());
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      expect(() => process.kill(pid, 0)).not.toThrow(); // Prove this OS can observe the live helper before testing disappearance.
      parent.kill("SIGKILL");
      await parent.exited;
      const end = Date.now() + 6500;
      let exists = true;
      while (exists && Date.now() < end) {
        try { process.kill(pid, 0); await Bun.sleep(25); }
        catch { exists = false; }
      }
      expect(exists).toBe(false);
      console.info(JSON.stringify({ nativeParentDeathScratch: dir, parentPid: parent.pid, helperPid: pid, helperExited: !exists }));
    } finally { if (parent.exitCode === null && parent.signalCode === null) parent.kill(); }
  }, 10000);
});
