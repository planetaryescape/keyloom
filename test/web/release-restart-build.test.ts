// "Restart Colima and build again" (R6-09, D-529): the build it starts after the restart must never replace a newer build the person
// started while the restart ran (PR #297 CodeRabbit).
import { describe, expect, test } from "bun:test";
import { type Release, restartThenBuild } from "../../src/web/release/useRelease.ts";

type Result = { ok: true } | { ok: false; reason: string; code?: string };

function harness() {
  let requests = 0;
  const built: number[] = [];
  const shown: Release["engineRestart"][] = [];
  const restart = Promise.withResolvers<Result>();
  const run = restartThenBuild({
    restart: () => restart.promise,
    requests: () => requests,
    build: () => built.push(++requests),
    show: (state) => shown.push(state),
  });
  return { run, restart, built, shown, ask: () => ++requests };
}

describe("restartThenBuild", () => {
  test("a restart that went through builds again at once", async () => {
    const h = harness();
    h.restart.resolve({ ok: true });
    await h.run;
    expect(h.built).toEqual([1]);
    expect(h.shown).toEqual([{ running: true, problem: null, again: true }, { running: false, problem: null, again: true }]);
  });

  test("a build asked for during the restart is newer: the restart starts none over it, and clears its own state", async () => {
    const h = harness();
    h.ask();
    h.restart.resolve({ ok: true });
    await h.run;
    expect(h.built).toEqual([]);
    expect(h.shown.at(-1)).toEqual({ running: false, problem: null, again: true });
  });

  test("a refusal after a newer build is not shown under that build, which has its own result", async () => {
    const h = harness();
    h.ask();
    h.restart.resolve({ ok: false, reason: "keyloom is running a build", code: "build_running" });
    await h.run;
    expect(h.shown.at(-1)).toEqual({ running: false, problem: null, again: true });
  });

  test("a refusal keeps the restart on offer; a failed restart says why and isn't offered again; no answer keeps it", async () => {
    for (const [result, again] of [[{ ok: false, reason: "busy", code: "build_running" }, true], [{ ok: false, reason: "Colima didn't start" }, false]] as const) {
      const h = harness();
      h.restart.resolve(result);
      await h.run;
      expect(h.built).toEqual([]);
      expect(h.shown.at(-1)).toEqual({ running: false, problem: result.reason, again });
    }
    const h = harness();
    h.restart.reject(new Error("keyloom stopped answering"));
    await h.run;
    expect(h.shown.at(-1)).toEqual({ running: false, problem: "keyloom stopped answering", again: true });
  });
});
