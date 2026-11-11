// A terminal's Ctrl-C goes to its whole foreground process group. These run keyloom's interrupt handling and a fake zapp in a real
// child process and signal that child's group, as a terminal does, so a flash tool that shares keyloom's group would get the
// signal too (D-506). The fake zapp and the USB check are files in a temporary directory; nothing here can reach a keyboard.
import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WRITE_IN_PROGRESS_MESSAGE } from "../../src/firmware/toolchain/write-guard.ts";
import { dfuImage, fakeBinDir } from "../helpers/fake-bin.ts";
import { SLOW_RUNNER_MS } from "../helpers/timeouts.ts";
import { tempDir } from "../helpers/tmp.ts";

const SRC = join(import.meta.dir, "../../src");

/** A child that flashes with a fake zapp under the CLI's untilInterrupted; the bootloader is "on USB" once `flag` exists. */
function flashScript(dir: string): string {
  const script = join(dir, "flash.ts");
  writeFileSync(script, `
import { existsSync } from "node:fs";
import { untilInterrupted } from ${JSON.stringify(join(SRC, "cli/commands/firmware.ts"))};
import { flashWithZapp } from ${JSON.stringify(join(SRC, "firmware/qmk/flash.ts"))};
import { LogSink } from ${JSON.stringify(join(SRC, "firmware/toolchain/run.ts"))};
const [zapp, artifact, logPath, flag] = process.argv.slice(2);
const r = await untilInterrupted((signal) => flashWithZapp({
  artifactPath: artifact, bootloader: "3297:2003", log: new LogSink(logPath), zapp, signal, pollMs: 20,
  bootloaderPresent: async () => existsSync(flag),
  onState: (state) => console.log("state " + state),
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

async function child(zappBody: (flag: string) => string) {
  const dir = tempDir();
  const flag = join(dir, "in-bootloader");
  const artifact = join(dir, "build.bin");
  await Bun.write(artifact, dfuImage("3297:2003"));
  const bin = fakeBinDir({ zapp: zappBody(flag) });
  // Its own process group, standing in for the terminal's foreground group that keyloom runs in.
  const proc = Bun.spawn(["bun", flashScript(dir), join(bin, "zapp"), artifact, join(dir, "flash.log"), flag], { detached: true, stdout: "pipe", stderr: "pipe" });
  const out = collect(proc.stdout);
  const err = collect(proc.stderr);
  const ctrlC = () => process.kill(-proc.pid, "SIGINT");
  return { dir, flag, proc, out, err, ctrlC };
}

describe("Ctrl-C during a flash (D-506)", () => {
  test("two Ctrl-Cs while zapp writes neither stop zapp nor end keyloom: the write finishes and keyloom says why it waits", async () => {
    const c = await child((flag) => `echo "Firmware loaded: x"; while [ ! -f "${flag}" ]; do sleep 0.05; done; sleep 1.5; echo wrote > "${flag}.written"; exit 0`);
    try {
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
    } finally {
      c.proc.kill("SIGKILL");
    }
  }, SLOW_RUNNER_MS);

  test("a Ctrl-C while zapp still waits for the bootloader stops zapp, and the flash is cancelled", async () => {
    const c = await child(() => `echo $$ > "$0.pid"; echo "Firmware loaded: x"; exec sleep 600`);
    try {
      await c.out.until("state waiting_for_bootloader");
      // zapp's line is read before the cancel, so keyloom has seen it start.
      await Bun.sleep(300);
      c.ctrlC();
      expect(await c.proc.exited).toBe(0);
      await c.out.done;
      expect(c.out.text()).toContain("result failed Cancelled. Nothing was flashed.");
    } finally {
      c.proc.kill("SIGKILL");
    }
  }, SLOW_RUNNER_MS);

  test("with no write under way, a second Ctrl-C ends keyloom, so a stop that hangs can still be left", async () => {
    const dir = tempDir();
    const script = join(dir, "hang.ts");
    writeFileSync(script, `
import { untilInterrupted } from ${JSON.stringify(join(SRC, "cli/commands/firmware.ts"))};
console.log("ready");
await untilInterrupted(() => new Promise(() => setInterval(() => {}, 1000)));
`);
    const proc = Bun.spawn(["bun", script], { detached: true, stdout: "pipe", stderr: "pipe" });
    const out = collect(proc.stdout);
    try {
      await out.until("ready");
      process.kill(-proc.pid, "SIGINT");
      await Bun.sleep(200);
      expect(proc.exitCode).toBeNull();
      process.kill(-proc.pid, "SIGINT");
      await proc.exited;
      expect(proc.signalCode ?? proc.exitCode).toBeOneOf(["SIGINT", 130]);
    } finally {
      proc.kill("SIGKILL");
    }
  }, SLOW_RUNNER_MS);
});
