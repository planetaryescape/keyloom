// The directory lock is an OS lock: exclusive between processes, gone when its holder dies (D-454).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { UsageError } from "../../src/app/index.ts";
import { type Clock, acquireDirectoryLock } from "../../src/server/directory-lock.ts";
import { tempDir } from "../helpers/tmp.ts";
import { SLOW_RUNNER_MS } from "../helpers/timeouts.ts";

const real: Clock = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
const LOCK = join(import.meta.dir, "../../src/server/directory-lock.ts");

/** A bun process that takes the lock, records "in"/"out" around `holdMs` of holding it, and releases. */
function contender(dir: string, log: string, holdMs: number, die = false) {
  const script = `
    import { acquireDirectoryLock } from ${JSON.stringify(LOCK)};
    import { appendFileSync } from "node:fs";
    const release = await acquireDirectoryLock(${JSON.stringify(dir)}, { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), deadline: Date.now() + 20000, pollMs: 10 });
    appendFileSync(${JSON.stringify(log)}, "in " + process.pid + "\\n");
    await new Promise((r) => setTimeout(r, ${holdMs}));
    appendFileSync(${JSON.stringify(log)}, "out " + process.pid + "\\n");
    ${die ? "process.kill(process.pid, 'SIGKILL');" : "release();"}
  `;
  return Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
}

describe("directory lock", () => {
  test("a second taker waits until the first releases, and release can be repeated", async () => {
    const dir = tempDir();
    const first = await acquireDirectoryLock(dir, { ...real, deadline: Date.now() + 1000 });
    let got = false;
    const second = acquireDirectoryLock(dir, { ...real, deadline: Date.now() + 2000, pollMs: 5 }).then((r) => ((got = true), r));
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toBe(false);
    first();
    first();
    (await second)();
    expect(got).toBe(true);
  });

  test("waiting past the deadline is a usage error, and it says what it was waiting for after a second", async () => {
    const dir = tempDir();
    const held = await acquireDirectoryLock(dir, { ...real, deadline: Date.now() + 1000 });
    let t = 0;
    const said: string[] = [];
    const err = await acquireDirectoryLock(dir, { now: () => t, sleep: async (ms) => void (t += ms), deadline: 3000, say: (l) => void said.push(l) }).catch((e) => e);
    held();
    expect(err).toBeInstanceOf(UsageError);
    expect(said).toHaveLength(1);
  });

  test(
    "processes contending for it take turns: never two inside at once",
    async () => {
      const dir = tempDir();
      const log = join(tempDir(), "order.log");
      const procs = Array.from({ length: 5 }, () => contender(dir, log, 60));
      for (const p of procs) expect(await p.exited).toBe(0);
      const lines = (await Bun.file(log).text()).trim().split("\n");
      expect(lines).toHaveLength(10);
      lines.forEach((line, i) => expect(line.startsWith(i % 2 === 0 ? "in" : "out")).toBe(true));
      for (let i = 0; i < lines.length; i += 2) expect(lines[i]!.split(" ")[1]).toBe(lines[i + 1]!.split(" ")[1]);
    },
    SLOW_RUNNER_MS,
  );

  test(
    "a holder that dies (SIGKILL) frees it with no stale file to break",
    async () => {
      const dir = tempDir();
      const log = join(tempDir(), "order.log");
      const dying = contender(dir, log, 30, true);
      await dying.exited;
      const release = await acquireDirectoryLock(dir, { ...real, deadline: Date.now() + 2000, pollMs: 10 });
      release();
      expect((await Bun.file(log).text()).trim().split("\n")).toHaveLength(2);
    },
    SLOW_RUNNER_MS,
  );
});
