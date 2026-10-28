// What serve does about a server already on the data directory, with the processes faked so the order of events is exact (D-454).
import { describe, expect, test } from "bun:test";
import { IncompatibleError, UsageError } from "../../src/app/index.ts";
import { type ExistingServerDeps, type ExistingServerRequest, resolveExistingServer } from "../../src/cli/serve-existing.ts";
import { acquireDirectoryLock } from "../../src/server/directory-lock.ts";
import type { ProcessDeps } from "../../src/server/replace-server.ts";
import type { RunningRecord } from "../../src/server/running-server.ts";
import { DESKTOP_PROTOCOL } from "../../src/server/server-compat.ts";
import { tempDir } from "../helpers/tmp.ts";

const mine = { version: "0.57.0", protocol: DESKTOP_PROTOCOL };
const server = (extra: Partial<RunningRecord> = {}): RunningRecord => ({ pid: 4242, url: "http://127.0.0.1:5/?t=tok", startedAt: "z", ...extra });

/** A clock that moves only when someone sleeps, and a process that exits `exitsAfterMs` after SIGTERM (never, if undefined). */
function fakeProcess(log: string[], opts: { exitsAfterMs?: number; exitsAtMs?: number; signalError?: string } = {}): ProcessDeps & { termAt: number | undefined } {
  let t = 0;
  const p = {
    termAt: undefined as number | undefined,
    signal: (pid: number, sig: "SIGTERM") => {
      log.push(`${sig} ${pid}`);
      if (opts.signalError) throw Object.assign(new Error(opts.signalError), { code: opts.signalError });
      p.termAt = t;
    },
    alive: (pid: number) => {
      if (pid === process.pid) return true;
      // A process that goes away on its own, unasked, at a fixed time.
      if (opts.exitsAtMs !== undefined) return t < opts.exitsAtMs;
      return p.termAt === undefined || opts.exitsAfterMs === undefined ? true : t - p.termAt < opts.exitsAfterMs;
    },
    sleep: async (ms: number) => void (t += ms),
    now: () => t,
  };
  return p;
}

/** A server that is live and is also what the directory names, which is how a stable server looks. */
const serving = (record: RunningRecord | undefined) => ({ live: async () => record, record: () => record });

function request(over: Partial<ExistingServerRequest> = {}) {
  const said: string[] = [];
  const req: ExistingServerRequest = { dir: tempDir(), reuse: true, replace: false, clientProtocol: DESKTOP_PROTOCOL, mine, say: (t) => void said.push(t), ...over };
  return { req, said };
}

describe("serve --reuse", () => {
  test("a compatible server is attached to", async () => {
    const { req, said } = request();
    const out = await resolveExistingServer(req, { ...serving(server({ version: "0.50.0", protocol: DESKTOP_PROTOCOL })) });
    expect(out).toEqual({ attached: true });
    expect(said).toEqual(["keyloom is already running at http://127.0.0.1:5/?t=tok\n"]);
  });

  test("an older incompatible server prints both marker lines and fails with the incompatible error", async () => {
    const { req, said } = request();
    const err = await resolveExistingServer(req, { ...serving(server({ version: "0.56.0", protocol: 0 })) }).catch((e) => e);
    expect(err).toBeInstanceOf(IncompatibleError);
    expect(said[0]).toStartWith("keyloom cannot attach: ");
    expect(said[0]).toContain("keyloom 0.56.0");
    expect(said[1]).toBe("keyloom can replace it: Use this app's keyloom\n");
    expect(err.message).toContain("--replace");
  });

  test("an unknown (pre-check) server is treated as older", async () => {
    const { req, said } = request();
    await expect(resolveExistingServer(req, { ...serving(server()) })).rejects.toBeInstanceOf(IncompatibleError);
    expect(said).toHaveLength(2);
    expect(said[0]).toContain("predates version checks");
  });

  test("a newer incompatible server gets update wording and no replace line", async () => {
    const { req, said } = request();
    const err = await resolveExistingServer(req, { ...serving(server({ version: "0.60.0", protocol: DESKTOP_PROTOCOL + 1 })) }).catch((e) => e);
    expect(err).toBeInstanceOf(IncompatibleError);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/newer than this 0\.57\.0/);
    expect(err.message).not.toContain("--replace");
  });

  test("without --client-protocol (a terminal) any server is attached to, as before", async () => {
    const { req } = request({ clientProtocol: undefined });
    expect(await resolveExistingServer(req, { ...serving(server()) })).toEqual({ attached: true });
  });

  test("no server means start one; without --reuse a live server is a usage error", async () => {
    expect(await resolveExistingServer(request().req, { live: async () => undefined })).toMatchObject({ attached: false });
    await expect(resolveExistingServer(request({ reuse: false }).req, { ...serving(server()) })).rejects.toBeInstanceOf(UsageError);
  });
});

describe("serve --replace", () => {
  test("checks the data directory, then stops the server, then waits for its process to exit, and only then lets the caller start", async () => {
    const log: string[] = [];
    const proc = fakeProcess(log, { exitsAfterMs: 2500 });
    const { req, said } = request({ reuse: false, replace: true });
    const deps: ExistingServerDeps = { ...serving(server({ version: "0.56.0", protocol: 0 })), process: proc, canOpen: () => void log.push("canOpen") };
    const out = await resolveExistingServer(req, deps);
    expect(out.attached).toBe(false);
    expect(log.indexOf("canOpen")).toBeLessThan(log.indexOf("SIGTERM 4242"));
    expect(log.filter((l) => l.startsWith("SIGTERM"))).toEqual(["SIGTERM 4242"]);
    // Returned only once the process had been gone: the clock moved past the exit time.
    expect(proc.now() - proc.termAt!).toBeGreaterThanOrEqual(2500);
    expect(said.some((l) => l.includes("keyboard sync that is writing"))).toBe(true);
    if (!out.attached) out.release();
  });

  test("a data directory this binary can't open stops nothing", async () => {
    const log: string[] = [];
    const { req } = request({ reuse: false, replace: true });
    const refuse = () => {
      throw new Error("schema too new");
    };
    await expect(resolveExistingServer(req, { ...serving(server()), process: fakeProcess(log), canOpen: refuse })).rejects.toThrow("schema too new");
    expect(log).toEqual([]);
  });

  test("a server that never exits is waited for, never killed, and the failure says so", async () => {
    const log: string[] = [];
    const { req } = request({ reuse: false, replace: true });
    const err = await resolveExistingServer(req, { ...serving(server()), process: fakeProcess(log), timeoutMs: 5000, canOpen: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("was not killed");
    expect(log).toEqual(["SIGTERM 4242"]);
    // The lock is released on failure: it can be taken at once.
    (await acquireDirectoryLock(req.dir, { ...fakeProcess([]), deadline: 0 }))();
  });

  test("a server owned by another user (EPERM) is left running with a clear message", async () => {
    const log: string[] = [];
    const { req } = request({ reuse: false, replace: true });
    const err = await resolveExistingServer(req, { ...serving(server()), process: fakeProcess(log, { signalError: "EPERM" }), canOpen: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("belongs to another user");
    expect(err.message).toContain("still running");
  });

  test("a server that is already gone by the time we signal it (ESRCH) is not an error", async () => {
    const { req } = request({ reuse: false, replace: true });
    const out = await resolveExistingServer(req, { ...serving(server()), process: fakeProcess([], { signalError: "ESRCH" }), canOpen: () => {} });
    expect(out.attached).toBe(false);
  });

  test("a newer server is refused, not stopped", async () => {
    const log: string[] = [];
    const { req, said } = request({ reuse: false, replace: true });
    const err = await resolveExistingServer(req, { ...serving(server({ version: "0.60.0", protocol: DESKTOP_PROTOCOL + 1 })), process: fakeProcess(log), canOpen: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(IncompatibleError);
    expect(err.message).toContain("downgrade");
    expect(said[0]).toStartWith("keyloom cannot attach: ");
    expect(log).toEqual([]);
  });

  test("an unknown-version server is replaced", async () => {
    const log: string[] = [];
    const { req } = request({ reuse: false, replace: true });
    const out = await resolveExistingServer(req, { ...serving(server()), process: fakeProcess(log, { exitsAfterMs: 0 }), canOpen: () => {} });
    expect(out.attached).toBe(false);
    expect(log).toEqual(["SIGTERM 4242"]);
  });

  test("with no server, it just starts", async () => {
    const log: string[] = [];
    const { req } = request({ reuse: false, replace: true });
    expect((await resolveExistingServer(req, { live: async () => undefined, process: fakeProcess(log), canOpen: () => {} })).attached).toBe(false);
    expect(log).toEqual([]);
  });

  test("an identical server is attached to rather than restarted", async () => {
    const log: string[] = [];
    const { req } = request({ reuse: false, replace: true });
    const out = await resolveExistingServer(req, { ...serving(server({ ...mine })), process: fakeProcess(log), canOpen: () => {} });
    expect(out).toEqual({ attached: true });
    expect(log).toEqual([]);
  });

  test("two racing --replace runs: the second waits for the first's lock, then finds the server the first started and attaches", async () => {
    const dir = tempDir();
    const log: string[] = [];
    let current: RunningRecord | undefined = server({ version: "0.56.0", protocol: 0 });
    // Real time here: the lock is shared by both runs.
    const deps = (): ExistingServerDeps => ({ live: async () => current, record: () => current, process: { ...fakeProcess(log, { exitsAfterMs: 0 }), sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), now: Date.now }, canOpen: () => {} });
    const a = request({ dir, reuse: false, replace: true });
    const b = request({ dir, reuse: false, replace: true });
    const first = await resolveExistingServer(a.req, deps());
    expect(first.attached).toBe(false);
    const second = resolveExistingServer(b.req, deps());
    await new Promise((r) => setTimeout(r, 50));
    // The first starts its server and announces, which releases the lock.
    current = server({ pid: 5151, ...mine });
    if (!first.attached) first.release();
    expect(await second).toEqual({ attached: true });
    expect(log.filter((l) => l.startsWith("SIGTERM"))).toEqual(["SIGTERM 4242"]);
  });

  test("a plain serve waits behind a replacer's lock instead of starting beside it", async () => {
    const dir = tempDir();
    const real: ProcessDeps = { ...fakeProcess([]), sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), now: Date.now };
    const holder = await acquireDirectoryLock(dir, { ...real, deadline: Date.now() + 1000 });
    let settled = false;
    const waiting = resolveExistingServer(request({ dir, reuse: false, replace: false }).req, { live: async () => undefined, process: real }).then((o) => ((settled = true), o));
    await new Promise((r) => setTimeout(r, 60));
    expect(settled).toBe(false);
    holder();
    const out = await waiting;
    expect(out.attached).toBe(false);
    if (!out.attached) out.release();
  });

  test("a --reuse that waited behind a replacer finds the server it started and attaches", async () => {
    const dir = tempDir();
    const real: ProcessDeps = { ...fakeProcess([]), sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), now: Date.now };
    const holder = await acquireDirectoryLock(dir, { ...real, deadline: Date.now() + 1000 });
    let current: RunningRecord | undefined;
    const waiting = resolveExistingServer(request({ dir, reuse: true, replace: false }).req, { live: async () => current, process: real });
    await new Promise((r) => setTimeout(r, 40));
    current = server({ pid: 5151, ...mine });
    holder();
    expect(await waiting).toEqual({ attached: true });
  });
});

describe("one deadline, and re-reading the record before a signal", () => {
  test("the lock wait and the stop wait share one budget", async () => {
    const dir = tempDir();
    const log: string[] = [];
    const proc = fakeProcess(log);
    // Another keyloom holds the lock for 6 s of fake time, then the old server never exits.
    const holder = await acquireDirectoryLock(dir, { ...proc, deadline: 1 });
    const real = proc.sleep;
    proc.sleep = async (ms) => {
      await real(ms);
      if (proc.now() >= 6000) holder();
    };
    const err = await resolveExistingServer(request({ dir, reuse: false, replace: true }).req, { ...serving(server()), process: proc, timeoutMs: 10_000, canOpen: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("was not killed");
    // Two separate 10 s budgets would have run to about 16 s.
    expect(proc.now()).toBeLessThan(10_500);
    expect(log).toEqual(["SIGTERM 4242"]);
  });

  test("a lock that is never released times out without stopping anything", async () => {
    const dir = tempDir();
    const log: string[] = [];
    const proc = fakeProcess(log);
    const holder = await acquireDirectoryLock(dir, { ...proc, deadline: 1 });
    const err = await resolveExistingServer(request({ dir, reuse: false, replace: true }).req, { ...serving(server()), process: proc, timeoutMs: 3000, canOpen: () => {} }).catch((e) => e);
    holder();
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("did not finish in time");
    expect(log).toEqual([]);
  });

  test("if the record changed since the server was found, nothing is signalled and the new one is judged", async () => {
    const log: string[] = [];
    const a = server({ pid: 4242, startedAt: "a", version: "0.56.0", protocol: 0 });
    const b = server({ pid: 5151, startedAt: "b", ...mine });
    const seen = [a, b];
    const out = await resolveExistingServer(request({ reuse: false, replace: true }).req, {
      live: async () => seen.shift(),
      // On disk, A has already been replaced by B when we are about to signal A.
      record: () => b,
      process: fakeProcess(log, { exitsAtMs: 0 }),
      canOpen: () => {},
    });
    expect(out).toEqual({ attached: true });
    expect(log).toEqual([]);
  });

  test("a record that keeps changing gives up without signalling", async () => {
    const log: string[] = [];
    let n = 0;
    const err = await resolveExistingServer(request({ reuse: false, replace: true }).req, {
      ...serving(server({ pid: 4000 + n++, startedAt: String(n), version: "0.56.0", protocol: 0 })),
      record: () => server({ pid: 1, startedAt: "elsewhere" }),
      process: fakeProcess(log, { exitsAtMs: 0 }),
      canOpen: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("keeps changing");
    expect(log).toEqual([]);
  });

  test("the record is checked immediately before the signal, with the same pid and start time", async () => {
    const log: string[] = [];
    const a = server({ startedAt: "a", version: "0.56.0", protocol: 0 });
    let asked = 0;
    const out = await resolveExistingServer(request({ reuse: false, replace: true }).req, {
      live: async () => a,
      record: () => (asked++, { ...a }),
      process: fakeProcess(log, { exitsAfterMs: 0 }),
      canOpen: () => {},
    });
    expect(out.attached).toBe(false);
    expect(asked).toBe(1);
    expect(log).toEqual(["SIGTERM 4242"]);
  });
});

describe("a verified server that is shutting down is not an absent one", () => {
  const draining = { draining: true, pid: 4242 } as const;

  for (const mode of ["plain", "reuse", "replace"] as const) {
    test(`${mode}: when the record vanished during the probe and its process is alive, nothing starts until the process has exited, and nothing is signalled`, async () => {
      const log: string[] = [];
      const proc = fakeProcess(log, { exitsAtMs: 2500 });
      const { req, said } = request({ reuse: mode === "reuse", replace: mode === "replace" });
      let looks = 0;
      const out = await resolveExistingServer(req, { live: async () => (looks++ === 0 ? draining : undefined), process: proc, canOpen: () => {} });
      expect(out.attached).toBe(false);
      expect(proc.now()).toBeGreaterThanOrEqual(2500);
      expect(looks).toBe(2);
      expect(log).toEqual([]);
      expect(said.some((l) => l.includes("keyboard sync that is writing"))).toBe(true);
      if (!out.attached) out.release();
    });
  }

  test("--replace: the record vanishing just before SIGTERM sends no signal, and the start waits for the process", async () => {
    const log: string[] = [];
    const proc = fakeProcess(log, { exitsAtMs: 3000 });
    const a = server({ version: "0.56.0", protocol: 0 });
    let looks = 0;
    const out = await resolveExistingServer(request({ reuse: false, replace: true }).req, {
      live: async () => (looks++ === 0 ? a : undefined),
      record: () => undefined,
      process: proc,
      canOpen: () => {},
    });
    expect(out.attached).toBe(false);
    expect(log).toEqual([]);
    expect(proc.now()).toBeGreaterThanOrEqual(3000);
  });

  test("a process that never exits times out with nothing started and nothing signalled", async () => {
    for (const vanish of ["during the probe", "before the signal"]) {
      const log: string[] = [];
      const proc = fakeProcess(log);
      const a = server({ version: "0.56.0", protocol: 0 });
      const deps: ExistingServerDeps = vanish === "during the probe" ? { live: async () => draining } : { live: async () => a, record: () => undefined };
      const err = await resolveExistingServer(request({ reuse: false, replace: true }).req, { ...deps, process: proc, timeoutMs: 5000, canOpen: () => {} }).catch((e) => e);
      expect(err).toBeInstanceOf(UsageError);
      expect(err.message).toContain("was already shutting down");
      expect(err.message).toContain("no second server was started");
      expect(proc.now()).toBeLessThan(5500);
      expect(log).toEqual([]);
    }
  });

  test("an exhausted budget signals nothing", async () => {
    for (const timeoutMs of [0, -1]) {
      const log: string[] = [];
      const err = await resolveExistingServer(request({ reuse: false, replace: true }).req, { ...serving(server({ version: "0.56.0", protocol: 0 })), process: fakeProcess(log), timeoutMs, canOpen: () => {} }).catch((e) => e);
      expect(err).toBeInstanceOf(UsageError);
      expect(log).toEqual([]);
    }
  });
});
