// A terminal's Ctrl-C goes to its whole foreground process group. These run keyloom's interrupt handling and a fake zapp in a real
// child process and signal that child's group, as a terminal does, so a flash tool that shares keyloom's group would get the
// signal too (D-506). The fake zapp and the USB check are files in a temporary directory; nothing here can reach a keyboard.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WRITE_IN_PROGRESS_MESSAGE } from "../../src/firmware/toolchain/write-guard.ts";
import { dfuImage, fakeBinDir } from "../helpers/fake-bin.ts";
import { SLOW_RUNNER_MS } from "../helpers/timeouts.ts";
import { tempDir } from "../helpers/tmp.ts";
import { combinedUf2, glove80 } from "../helpers/zmk.ts";
import { zmkRevision } from "../../src/firmware/zmk/board-config.ts";

const SRC = join(import.meta.dir, "../../src");

/**
 * A child that flashes with a fake zapp under the CLI's untilInterrupted; the bootloader is "on USB" once `flag` exists. With
 * `usb: "unreadable"` every USB read fails, and short waits let the write timeout end the flash. With `usb: "slow"` each read takes 1 s.
 */
function flashScript(dir: string, opts: { usb?: "unreadable" | "slow" } = {}): string {
  const script = join(dir, "flash.ts");
  const present = opts.usb === "unreadable"
    ? `async () => { throw new Error("system_profiler failed"); }`
    : opts.usb === "slow" ? `async () => { await Bun.sleep(1000); return existsSync(flag); }` : `async () => existsSync(flag)`;
  const waits = opts.usb === "unreadable" ? "bootloaderWaitMs: 1500, writeTimeoutMs: 1500," : "";
  writeFileSync(script, `
import { existsSync } from "node:fs";
import { untilInterrupted } from ${JSON.stringify(join(SRC, "cli/commands/firmware.ts"))};
import { flashWithZapp } from ${JSON.stringify(join(SRC, "firmware/qmk/flash.ts"))};
import { LogSink } from ${JSON.stringify(join(SRC, "firmware/toolchain/run.ts"))};
const [zapp, artifact, logPath, flag] = process.argv.slice(2);
const r = await untilInterrupted((signal) => flashWithZapp({
  artifactPath: artifact, bootloader: "3297:2003", log: new LogSink(logPath), zapp, signal, pollMs: 20, ${waits}
  bootloaderPresent: ${present},
  onState: (state) => console.log("state " + state),
  onLine: (line) => console.log("zapp " + line),
}));
console.log("result " + r.state + " " + (r.error ?? ""));
`);
  return script;
}

/** Collects a stream as it arrives, so the test can wait for a line while the child runs. */
function collect(stream: ReadableStream<Uint8Array>) {
  let text = "";
  const done = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  })();
  return {
    text: () => text,
    done,
    until: async (wanted: string, ms = 15_000) => {
      const by = Date.now() + ms;
      while (!text.includes(wanted)) {
        if (Date.now() > by) throw new Error(`never printed "${wanted}"; got: ${text}`);
        await Bun.sleep(20);
      }
    },
  };
}

/**
 * Every child here runs in its own process group, and keyloom starts zapp in another (D-506), so killing the child leaves zapp and its
 * `sleep` running (R4 residual 8). Each test's groups are killed after it, whether it passed or not.
 */
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});

/** SIGKILLs a process group, or the process alone when it doesn't lead one. Gone already is fine. */
function killGroup(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

/** A detached child, killed with its group after the test. */
function spawnGroup(cmd: string[]) {
  const proc = Bun.spawn(cmd, { detached: true, stdout: "pipe", stderr: "pipe" });
  cleanups.push(() => killGroup(proc.pid));
  return proc;
}

/**
 * The fake zapp writes its start time and then its pid beside itself first, so the test can kill its group even when keyloom never
 * stopped it, and can tell it from a process that reused the pid: `exec sleep` keeps the start time but drops the fake's path.
 */
const ZAPP_PID = `ps -o lstart= -p $$ > "$0.started"; echo $$ > "$0.pid"; `;

async function child(zappBody: (flag: string) => string, opts: { usb?: "unreadable" | "slow" } = {}) {
  const dir = tempDir();
  const flag = join(dir, "in-bootloader");
  const artifact = join(dir, "build.bin");
  await Bun.write(artifact, dfuImage("3297:2003"));
  const bin = fakeBinDir({ zapp: ZAPP_PID + zappBody(flag) });
  const zappPath = join(bin, "zapp");
  const zappPid = `${zappPath}.pid`;
  cleanups.push(() => {
    if (!existsSync(zappPid)) return;
    const pid = Number(readFileSync(zappPid, "utf8").trim());
    // A file read while the shell was still writing it is empty, and Number("") is 0: process group 0 is this test runner's (#290 review).
    if (!Number.isSafeInteger(pid) || pid <= 1) return;
    // A recorded pid alive with another start time was reused after the fake ended: that process isn't this test's (#290 review).
    if (!alive(pid)) return killGroup(pid);
    const started = existsSync(`${zappPath}.started`) ? readFileSync(`${zappPath}.started`, "utf8").trim() : "";
    const now = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)]).stdout.toString().trim();
    if (started !== "" && started === now) killGroup(pid);
  });
  // Its own process group, standing in for the terminal's foreground group that keyloom runs in.
  const proc = spawnGroup(["bun", flashScript(dir, opts), zappPath, artifact, join(dir, "flash.log"), flag]);
  const out = collect(proc.stdout);
  const err = collect(proc.stderr);
  const ctrlC = () => process.kill(-proc.pid, "SIGINT");
  return { dir, bin, flag, proc, out, err, ctrlC };
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A child that flashes a Glove80 into a temporary /Volumes under untilInterrupted. Its restart hook says it is restarting the half,
 * then takes 1.5 s before the half's drive mounts, as restartHalf's wait for the drive does; a write takes the drive away.
 */
async function zmkChild() {
  const dir = tempDir();
  const root = join(dir, "Volumes");
  mkdirSync(root);
  const artifact = join(dir, "glove80.uf2");
  await Bun.write(artifact, combinedUf2());
  const steps = join(dir, "steps.json");
  writeFileSync(steps, JSON.stringify(zmkRevision((await glove80()).definition).flash.steps));
  const script = join(dir, "flash-zmk.ts");
  writeFileSync(script, `
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { untilInterrupted } from ${JSON.stringify(join(SRC, "cli/commands/firmware.ts"))};
import { flashUf2Drives } from ${JSON.stringify(join(SRC, "firmware/zmk/flash.ts"))};
import { volumeFinderAt } from ${JSON.stringify(join(SRC, "firmware/zmk/volumes.ts"))};
import { LogSink } from ${JSON.stringify(join(SRC, "firmware/toolchain/run.ts"))};
const [root, artifact, logPath, stepsPath] = process.argv.slice(2);
const r = await untilInterrupted((signal) => flashUf2Drives({
  artifactPath: artifact, steps: JSON.parse(readFileSync(stepsPath, "utf8")), findVolume: volumeFinderAt(root, { mountedOnly: false }), log: new LogSink(logPath), signal,
  pollMs: 10, bootloaderWaitMs: 5000, unmountWaitMs: 2000,
  onState: (state) => console.log("state " + state),
  writeImage: async (path, bytes) => {
    writeFileSync(path, bytes);
    setTimeout(() => rmSync(dirname(path), { recursive: true, force: true }), 30);
  },
  hooks: {
    enterBootloader: async (step, _i, announce) => {
      announce("keyloom is restarting the " + step.label + " into its bootloader. Don't touch the keyboard.");
      console.log("restarting " + step.label);
      await Bun.sleep(1500);
      mkdirSync(join(root, step.volume), { recursive: true });
      return { ok: true };
    },
  },
}));
console.log("result " + r.state + " " + (r.error ?? ""));
`);
  const proc = spawnGroup(["bun", script, root, artifact, join(dir, "flash.log"), steps]);
  return { proc, out: collect(proc.stdout), err: collect(proc.stderr), ctrlC: () => process.kill(-proc.pid, "SIGINT") };
}

describe("Ctrl-C during a flash (D-506)", () => {
  test("two Ctrl-Cs while zapp writes neither stop zapp nor end keyloom: the write finishes and keyloom says why it waits", async () => {
    const c = await child((flag) => `echo "Firmware loaded: x"; while [ ! -f "${flag}" ]; do sleep 0.05; done; sleep 1.5; echo wrote > "${flag}.written"; exit 0`);
    await c.out.until("state waiting_for_bootloader");
    writeFileSync(c.flag, "");
    await c.out.until("state writing");
    c.ctrlC();
    await Bun.sleep(200);
    c.ctrlC();
    expect(await c.proc.exited).toBe(0);
    await c.out.done;
    await c.err.done;
    expect(c.out.text()).toContain("result succeeded");
    expect(c.err.text()).toContain(WRITE_IN_PROGRESS_MESSAGE);
    expect(existsSync(`${c.flag}.written`)).toBe(true);
  }, SLOW_RUNNER_MS);

  test("a Ctrl-C while zapp still waits for the bootloader stops zapp, and the flash is cancelled", async () => {
    const c = await child(() => `echo "Firmware loaded: x"; exec sleep 600`);
    await c.out.until("state waiting_for_bootloader");
    // zapp's line is read before the cancel, so keyloom has seen it start.
    await Bun.sleep(300);
    c.ctrlC();
    expect(await c.proc.exited).toBe(0);
    await c.out.done;
    expect(c.out.text()).toContain("result failed Cancelled. Nothing was flashed.");
  }, SLOW_RUNNER_MS);

  test("two Ctrl-Cs while keyloom can't read USB neither end keyloom nor orphan zapp: the write timeout ends zapp", async () => {
    const c = await child(() => `echo "Firmware loaded: x"; exec sleep 600`, { usb: "unreadable" });
    const pidFile = () => join(c.bin, "zapp.pid");
    await c.out.until("state waiting_for_bootloader");
    // zapp's line is read before the cancel, so keyloom has seen it start.
    await Bun.sleep(300);
    c.ctrlC();
    // keyloom tries USB three times before it decides zapp may be writing.
    await Bun.sleep(400);
    c.ctrlC();
    expect(await c.proc.exited).toBe(0);
    await c.out.done;
    await c.err.done;
    expect(c.out.text()).toContain("result failed");
    expect(c.err.text()).toContain(WRITE_IN_PROGRESS_MESSAGE);
    expect(alive(Number(readFileSync(pidFile(), "utf8").trim()))).toBe(false);
  }, SLOW_RUNNER_MS);

  test("a second Ctrl-C while the first one's USB check runs neither ends keyloom nor orphans zapp: zapp is stopped and the flash cancelled", async () => {
    const c = await child(() => `echo "Firmware loaded: x"; exec sleep 600`, { usb: "slow" });
    const pidFile = () => join(c.bin, "zapp.pid");
    // keyloom has read zapp's line, so the cancel looks at USB before it stops zapp. Before that line it stops zapp at once.
    await c.out.until("zapp Firmware loaded");
    c.ctrlC();
    // The cancel's USB read takes a second; this lands inside it.
    await Bun.sleep(200);
    c.ctrlC();
    expect(await c.proc.exited).toBe(0);
    await c.out.done;
    await c.err.done;
    expect(c.out.text()).toContain("result failed Cancelled. Nothing was flashed.");
    expect(c.err.text()).toContain(WRITE_IN_PROGRESS_MESSAGE);
    expect(alive(Number(readFileSync(pidFile(), "utf8").trim()))).toBe(false);
  }, SLOW_RUNNER_MS);

  test("two Ctrl-Cs while keyloom restarts a ZMK half neither end keyloom: the half keyloom restarted is written", async () => {
    const c = await zmkChild();
    await c.out.until("restarting right half");
    c.ctrlC();
    await Bun.sleep(200);
    c.ctrlC();
    expect(await c.proc.exited).toBe(0);
    await c.out.done;
    await c.err.done;
    expect(c.out.text()).toContain("result succeeded");
    expect(c.err.text()).toContain(WRITE_IN_PROGRESS_MESSAGE);
  }, SLOW_RUNNER_MS);

  test("with no write under way, a second Ctrl-C ends keyloom, so a stop that hangs can still be left", async () => {
    const dir = tempDir();
    const script = join(dir, "hang.ts");
    writeFileSync(script, `
import { untilInterrupted } from ${JSON.stringify(join(SRC, "cli/commands/firmware.ts"))};
console.log("ready");
await untilInterrupted(() => new Promise(() => setInterval(() => {}, 1000)));
`);
    const proc = spawnGroup(["bun", script]);
    const out = collect(proc.stdout);
    await out.until("ready");
    process.kill(-proc.pid, "SIGINT");
    await Bun.sleep(200);
    expect(proc.exitCode).toBeNull();
    process.kill(-proc.pid, "SIGINT");
    await proc.exited;
    expect(proc.signalCode ?? proc.exitCode).toBeOneOf(["SIGINT", 130]);
  }, SLOW_RUNNER_MS);
});
