// What serve does about a server already on the data directory, with the processes faked so the order of events is exact (D-454).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { IncompatibleError, UsageError } from "../../src/app/index.ts";
import { type ExistingServerDeps, type ExistingServerRequest, resolveExistingServer } from "../../src/cli/serve-existing.ts";
import type { ProcessDeps } from "../../src/server/replace-server.ts";
import type { RunningRecord } from "../../src/server/running-server.ts";
import { DESKTOP_PROTOCOL } from "../../src/server/server-compat.ts";
import { tempDir } from "../helpers/tmp.ts";

const mine = { version: "0.57.0", protocol: DESKTOP_PROTOCOL };
const server = (extra: Partial<RunningRecord> = {}): RunningRecord => ({ pid: 4242, url: "http://127.0.0.1:5/?t=tok", startedAt: "z", ...extra });

/** A clock that moves only when someone sleeps, and a process that exits `exitsAfterMs` after SIGTERM (never, if undefined). */
function fakeProcess(log: string[], opts: { exitsAfterMs?: number; signalError?: string } = {}): ProcessDeps & { termAt: number | undefined } {
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
      return p.termAt === undefined || opts.exitsAfterMs === undefined ? true : t - p.termAt < opts.exitsAfterMs;
    },
    sleep: async (ms: number) => void (t += ms),
    now: () => t,
  };
  return p;
}

function request(over: Partial<ExistingServerRequest> = {}) {
  const said: string[] = [];
  const req: ExistingServerRequest = { dir: tempDir(), reuse: true, replace: false, clientProtocol: DESKTOP_PROTOCOL, mine, say: (t) => void said.push(t), ...over };
  return { req, said };
}

describe("serve --reuse", () => {
  test("a compatible server is attached to", async () => {
    const { req, said } = request();
    const out = await resolveExistingServer(req, { live: async () => server({ version: "0.50.0", protocol: DESKTOP_PROTOCOL }) });
    expect(out).toEqual({ attached: true });
    expect(said).toEqual(["keyloom is already running at http://127.0.0.1:5/?t=tok\n"]);
  });

  test("an older incompatible server prints both marker lines and fails with the incompatible error", async () => {
    const { req, said } = request();
    const err = await resolveExistingServer(req, { live: async () => server({ version: "0.56.0", protocol: 0 }) }).catch((e) => e);
    expect(err).toBeInstanceOf(IncompatibleError);
    expect(said[0]).toStartWith("keyloom cannot attach: ");
    expect(said[0]).toContain("keyloom 0.56.0");
    expect(said[1]).toBe("keyloom can replace it: Use this app's keyloom\n");
    expect(err.message).toContain("--replace");
  });

  test("an unknown (pre-check) server is treated as older", async () => {
    const { req, said } = request();
    await expect(resolveExistingServer(req, { live: async () => server() })).rejects.toBeInstanceOf(IncompatibleError);
    expect(said).toHaveLength(2);
    expect(said[0]).toContain("predates version checks");
  });

  test("a newer incompatible server gets update wording and no replace line", async () => {
    const { req, said } = request();
    const err = await resolveExistingServer(req, { live: async () => server({ version: "0.60.0", protocol: DESKTOP_PROTOCOL + 1 }) }).catch((e) => e);
    expect(err).toBeInstanceOf(IncompatibleError);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/newer than this 0\.57\.0/);
    expect(err.message).not.toContain("--replace");
  });

  test("without --client-protocol (a terminal) any server is attached to, as before", async () => {
    const { req } = request({ clientProtocol: undefined });
    expect(await resolveExistingServer(req, { live: async () => server() })).toEqual({ attached: true });
  });

  test("no server means start one; without --reuse a live server is a usage error", async () => {
    expect(await resolveExistingServer(request().req, { live: async () => undefined })).toMatchObject({ attached: false });
    await expect(resolveExistingServer(request({ reuse: false }).req, { live: async () => server() })).rejects.toBeInstanceOf(UsageError);
  });
});

describe("serve --replace", () => {
  test("checks the data directory, then stops the server, then waits for its process to exit, and only then lets the caller start", async () => {
    const log: string[] = [];
    const proc = fakeProcess(log, { exitsAfterMs: 2500 });
    const { req, said } = request({ reuse: false, replace: true });
    const deps: ExistingServerDeps = { live: async () => (log.push("look"), server({ version: "0.56.0", protocol: 0 })), process: proc, canOpen: () => void log.push("canOpen") };
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
    await expect(resolveExistingServer(req, { live: async () => server(), process: fakeProcess(log), canOpen: refuse })).rejects.toThrow("schema too new");
    expect(log).toEqual([]);
  });

  test("a server that never exits is waited for, never killed, and the failure says so", async () => {
    const log: string[] = [];
    const { req } = request({ reuse: false, replace: true });
    const err = await resolveExistingServer(req, { live: async () => server(), process: fakeProcess(log), timeoutMs: 5000, canOpen: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("was not killed");
    expect(log).toEqual(["SIGTERM 4242"]);
    // The lock is released on failure.
    expect(existsSync(join(req.dir, "serve.lock"))).toBe(false);
  });

  test("a server owned by another user (EPERM) is left running with a clear message", async () => {
    const log: string[] = [];
    const { req } = request({ reuse: false, replace: true });
    const err = await resolveExistingServer(req, { live: async () => server(), process: fakeProcess(log, { signalError: "EPERM" }), canOpen: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("belongs to another user");
    expect(err.message).toContain("still running");
  });

  test("a server that is already gone by the time we signal it (ESRCH) is not an error", async () => {
    const { req } = request({ reuse: false, replace: true });
    const out = await resolveExistingServer(req, { live: async () => server(), process: fakeProcess([], { signalError: "ESRCH" }), canOpen: () => {} });
    expect(out.attached).toBe(false);
  });

  test("a newer server is refused, not stopped", async () => {
    const log: string[] = [];
    const { req, said } = request({ reuse: false, replace: true });
    const err = await resolveExistingServer(req, { live: async () => server({ version: "0.60.0", protocol: DESKTOP_PROTOCOL + 1 }), process: fakeProcess(log), canOpen: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(IncompatibleError);
    expect(err.message).toContain("downgrade");
    expect(said[0]).toStartWith("keyloom cannot attach: ");
    expect(log).toEqual([]);
  });

  test("an unknown-version server is replaced", async () => {
    const log: string[] = [];
    const { req } = request({ reuse: false, replace: true });
    const out = await resolveExistingServer(req, { live: async () => server(), process: fakeProcess(log, { exitsAfterMs: 0 }), canOpen: () => {} });
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
    const out = await resolveExistingServer(req, { live: async () => server({ ...mine }), process: fakeProcess(log), canOpen: () => {} });
    expect(out).toEqual({ attached: true });
    expect(log).toEqual([]);
  });

  test("two racing --replace runs: the second waits for the first's lock, then finds the server the first started and attaches", async () => {
    const dir = tempDir();
    const log: string[] = [];
    let current: RunningRecord | undefined = server({ version: "0.56.0", protocol: 0 });
    // Real time here: the lock is a file shared by both runs.
    const deps = (): ExistingServerDeps => ({ live: async () => current, process: { ...fakeProcess(log, { exitsAfterMs: 0 }), sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) }, canOpen: () => {} });
    const a = request({ dir, reuse: false, replace: true });
    const b = request({ dir, reuse: false, replace: true });
    const first = await resolveExistingServer(a.req, deps());
    expect(first.attached).toBe(false);
    const second = resolveExistingServer(b.req, deps());
    // The first starts its server and announces, which releases the lock.
    await new Promise((r) => setTimeout(r, 50));
    current = server({ pid: 5151, ...mine });
    if (!first.attached) first.release();
    expect(await second).toEqual({ attached: true });
    expect(log.filter((l) => l.startsWith("SIGTERM"))).toEqual(["SIGTERM 4242"]);
  });
});
