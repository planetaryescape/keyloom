// "Restart Colima and build again" (R6-09, D-529): the build it starts after the restart must never replace a newer build the person
// started while the restart ran (PR #297 CodeRabbit). A refusal because work runs waits for that work and asks again (R7-04).
import { describe, expect, test } from "bun:test";
import { type EngineRestartRun, RESTART_WAIT_LIMIT_MS, restartLogStep, restartThenBuild } from "../../src/web/release/useRelease.ts";

type Result = { ok: true } | { ok: false; reason: string; code?: string };

const IDLE: EngineRestartRun = { running: false, problem: null, again: true, waitingFor: null };
const RUNNING: EngineRestartRun = { ...IDLE, running: true };

/**
 * `results` answers each restart in turn, `waits` each read of what the restart waits for. `sleeps` answers each wait: true to go on,
 * false to cancel it, as Cancel restart does. `clock` moves forward by `stepMs` on every wait.
 */
function harness(opts: { results: Array<Result | Error>; waits?: Array<readonly string[] | null>; sleeps?: boolean[]; stepMs?: number; onSleep?: () => void; current?: () => boolean }) {
  let requests = 0;
  let clock = 0;
  const built: number[] = [];
  const shown: EngineRestartRun[] = [];
  const cancel = new AbortController();
  const restarts: number[] = [];
  let failed = 0;
  const results = [...opts.results];
  const waits = [...(opts.waits ?? [])];
  const sleeps = [...(opts.sleeps ?? [])];
  const run = restartThenBuild({
    restart: async () => {
      restarts.push(clock);
      const next = results.shift() ?? { ok: true };
      if (next instanceof Error) throw next;
      return next;
    },
    waitingFor: async () => (waits.length === 0 ? [] : waits.shift() ?? null),
    requests: () => requests,
    ...(opts.current ? { current: opts.current } : {}),
    build: () => built.push(++requests),
    show: (state) => shown.push(state),
    signal: cancel.signal,
    sleep: async () => {
      clock += opts.stepMs ?? 5000;
      opts.onSleep?.();
      if (sleeps.shift() === false) cancel.abort();
    },
    failed: () => failed++,
    now: () => clock,
  });
  return { run, built, shown, restarts, failed: () => failed, ask: () => ++requests };
}

const busy: Result = { ok: false, reason: "keyloom is running a lab analysis, and restarting Docker now would stop it.", code: "build_running" };

describe("restartThenBuild", () => {
  test("a restart that went through builds again at once", async () => {
    const h = harness({ results: [{ ok: true }] });
    await h.run;
    expect(h.built).toEqual([1]);
    expect(h.shown).toEqual([RUNNING, IDLE]);
  });

  test("a build asked for during the restart is newer: the restart starts none over it, and clears its own state", async () => {
    const h = harness({ results: [] });
    h.ask();
    // The restart answers after the newer build was asked for.
    await h.run;
    expect(h.built).toEqual([]);
    expect(h.shown.at(-1)).toEqual(IDLE);
  });

  test("a refusal while work runs waits for it, names it, and restarts by itself once it ends (R7-04)", async () => {
    const h = harness({ results: [busy, { ok: true }], waits: [["a lab analysis"], ["a lab analysis"], []] });
    await h.run;
    expect(h.shown).toEqual([
      RUNNING,
      { ...IDLE, waitingFor: ["a lab analysis"] },
      { ...IDLE, waitingFor: ["a lab analysis"] },
      RUNNING,
      IDLE,
    ]);
    // Asked twice: once refused, once after the work ended. Never while the work was named.
    expect(h.restarts).toEqual([0, 10_000]);
    expect(h.built).toEqual([1]);
  });

  test("asking once the work seems to end can still be refused, and the wait goes on: the server's own check decides (D-529)", async () => {
    const h = harness({ results: [busy, busy, { ok: true }], waits: [["a build"], [], ["a build"], []] });
    await h.run;
    expect(h.restarts).toHaveLength(3);
    expect(h.built).toEqual([1]);
  });

  test("Cancel stops waiting: nothing restarts, and the button is offered again", async () => {
    const h = harness({ results: [busy], waits: [["a lab analysis"]], sleeps: [false] });
    await h.run;
    expect(h.restarts).toHaveLength(1);
    expect(h.built).toEqual([]);
    expect(h.shown.at(-1)).toEqual(IDLE);
  });

  test("a newer build asked for while it waits ends the wait, with nothing restarted", async () => {
    let h: ReturnType<typeof harness> | undefined;
    h = harness({ results: [busy], waits: [["a build"], ["a build"]], onSleep: () => h?.ask() });
    await h.run;
    expect(h.restarts).toHaveLength(1);
    expect(h.shown.at(-1)).toEqual(IDLE);
  });

  test("a change to the revision on screen while it waits ends the wait: nothing restarts, and the old revision isn't built (PR #303 review)", async () => {
    let shown = "rev-1";
    const h = harness({ results: [busy, { ok: true }], waits: [["a lab analysis"], []], onSleep: () => (shown = "rev-2"), current: () => shown === "rev-1" });
    await h.run;
    expect(h.restarts).toHaveLength(1);
    expect(h.built).toEqual([]);
    expect(h.shown.at(-1)).toEqual(IDLE);
  });

  test("a restart that went through while the revision on screen changed builds nothing (PR #303 review)", async () => {
    let shown = "rev-1";
    const restart = Promise.withResolvers<Result>();
    const built: string[] = [];
    const states: EngineRestartRun[] = [];
    const run = restartThenBuild({
      restart: () => restart.promise,
      waitingFor: async () => [],
      requests: () => built.length,
      current: () => shown === "rev-1",
      build: () => built.push("rev-1"),
      show: (state) => states.push(state),
      signal: new AbortController().signal,
    });
    shown = "rev-2";
    restart.resolve({ ok: true });
    await run;
    expect(built).toEqual([]);
    expect(states.at(-1)).toEqual(IDLE);
  });

  test("a dialog closed while the request is out builds nothing after it went through, but still shows a failure (PR #303 CodeRabbit)", async () => {
    for (const answer of [{ ok: true } as const, new Error("keyloom stopped answering")]) {
      const close = new AbortController();
      const restart = Promise.withResolvers<Result>();
      let built = 0;
      let failed = 0;
      const states: EngineRestartRun[] = [];
      const run = restartThenBuild({
        restart: () => restart.promise,
        waitingFor: async () => [],
        requests: () => built,
        build: () => built++,
        show: (state) => states.push(state),
        signal: close.signal,
        failed: () => failed++,
      });
      close.abort();
      if (answer instanceof Error) restart.reject(answer);
      else restart.resolve(answer);
      await run;
      expect(built).toBe(0);
      if (answer instanceof Error) {
        expect(states.at(-1)).toEqual({ ...IDLE, problem: "keyloom stopped answering" });
        expect(failed).toBe(1);
      } else expect(states.at(-1)).toEqual(IDLE);
    }
  });

    test("a refusal with nothing named to wait for shows its reason and keeps the button: an older server, or work that just ended", async () => {
    for (const wait of [null, []] as const) {
      const h = harness({ results: [busy], waits: [wait] });
      await h.run;
      expect(h.shown.at(-1)).toEqual({ ...IDLE, problem: busy.ok ? null : busy.reason });
      expect(h.restarts).toHaveLength(1);
    }
  });

  test("a wait that passes its limit stops waiting and offers the button again", async () => {
    const forever = Array.from({ length: 400 }, () => ["a build"]);
    const h = harness({ results: [busy], waits: forever, stepMs: 60_000 });
    await h.run;
    expect(h.shown.at(-1)).toMatchObject({ waitingFor: null, again: true, problem: expect.stringContaining("stopped waiting") });
    expect(h.restarts).toHaveLength(1);
    expect(h.shown.filter((s) => s.waitingFor !== null).length).toBe(RESTART_WAIT_LIMIT_MS / 60_000);
  });

  test("a Cancel or a newer build while a read of the work is out never restarts, even when the read says nothing runs (PR #303 CodeRabbit)", async () => {
    for (const end of ["cancel", "newer"] as const) {
      let restarts = 0;
      let requests = 0;
      const shown: EngineRestartRun[] = [];
      const cancel = new AbortController();
      const read = Promise.withResolvers<readonly string[]>();
      let reads = 0;
      const run = restartThenBuild({
        restart: async () => (restarts++, restarts === 1 ? busy : { ok: true }),
        waitingFor: () => (++reads === 1 ? Promise.resolve(["a build"]) : read.promise),
        requests: () => requests,
        build: () => requests++,
        show: (state) => shown.push(state),
        signal: cancel.signal,
        sleep: async () => {},
      });
      await Bun.sleep(0);
      if (end === "cancel") cancel.abort();
      else requests++;
      read.resolve([]);
      await run;
      expect(restarts).toBe(1);
      expect(shown.at(-1)).toEqual(IDLE);
    }
  });

  test("engine_busy waits like build_running", async () => {
    const h = harness({ results: [{ ok: false, reason: "keyloom is already starting Docker", code: "engine_busy" }, { ok: true }], waits: [["a Docker start"], []] });
    await h.run;
    expect(h.built).toEqual([1]);
  });

  test("a failed restart says why, isn't offered again, and reads Docker again; no answer keeps it", async () => {
    const h = harness({ results: [{ ok: false, reason: "Colima didn't start" }] });
    await h.run;
    expect(h.built).toEqual([]);
    expect(h.shown.at(-1)).toEqual({ ...IDLE, problem: "Colima didn't start", again: false });
    expect(h.failed()).toBe(1);
    const lost = harness({ results: [new Error("keyloom stopped answering")] });
    await lost.run;
    expect(lost.shown.at(-1)).toEqual({ ...IDLE, problem: "keyloom stopped answering" });
    // The request may have stopped the engine before it failed, so Docker is read again (PR #303 CodeRabbit).
    expect(lost.failed()).toBe(1);
  });

  // R10-07: the request's code stays, so the dialog shows Restart keyloom beside it, and a restart that fails the same way goes.
  test("a restart request that fails no way the page planned for keeps its code; an unreadable one isn't offered again", async () => {
    const unreadable = harness({ results: [Object.assign(new Error("keyloom sent an answer this page can't read"), { code: "unreadable" })] });
    await unreadable.run;
    expect(unreadable.shown.at(-1)).toEqual({ ...IDLE, problem: "keyloom sent an answer this page can't read", failure: { message: "keyloom sent an answer this page can't read", code: "unreadable" }, again: false });
    const internal = harness({ results: [Object.assign(new Error("keyloom hit a problem"), { code: "internal" })] });
    await internal.run;
    // An exception can pass on a second try, so the restart stays.
    expect(internal.shown.at(-1)).toMatchObject({ failure: { code: "internal" }, again: true });
  });
});

describe("restartLogStep (R7-04)", () => {
  test("polls while a request is out, and reads once more when it ends, even one that failed before the first poll (PR #303 CodeRabbit)", () => {
    expect(restartLogStep(false, true)).toBe("poll");
    expect(restartLogStep(true, false)).toBe("final");
    expect(restartLogStep(false, false)).toBe("none");
  });
});
