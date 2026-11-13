// R10-07: a running install whose reads keep failing says keyloom lost track of it, instead of "Installing…" for ever with nothing said.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InstallState } from "../../src/api/tool-install.ts";
import { InstallLost } from "../../src/web/release/InstallCancel.tsx";
import { INSTALL_IDLE, type Install, type InstallTrack, LOST_AFTER, installLost, installTrack } from "../../src/web/release/useInstall.ts";
import type { PageFailure } from "../../src/web/shell/unexpected.ts";
import { retryHelps } from "../../src/web/release/UnexpectedActions.tsx";

describe("installLost", () => {
  test("a lost connection keeps reading by itself, and Check again can pass", () => {
    const lost = installLost({ message: "keyloom isn't answering.", code: "unreachable" });
    expect(lost).toEqual({ failure: { message: "keyloom lost track of the install, so it can't say how it is going. It keeps checking by itself.", code: "unreachable" }, keepReading: true });
    expect(retryHelps(lost.failure)).toBe(true);
  });

  test("an exception keeps reading and keeps keyloom's own words, which name the log", () => {
    const lost = installLost({ message: "keyloom hit a problem it didn't expect. The details are in keyloom's log.", code: "internal" });
    expect(lost.keepReading).toBe(true);
    expect(lost.failure.message).toEndWith("It keeps checking by itself. keyloom hit a problem it didn't expect. The details are in keyloom's log.");
  });

  test("an answer the page can't read, or keyloom's catch-all 404, stops reading and offers no Check again", () => {
    for (const failure of [{ message: "keyloom sent an answer this page can't read.", code: "unreadable" }, { message: "keyloom couldn't find what this page asked for.", code: "not_found", generic: true }]) {
      const lost = installLost(failure);
      expect(lost.keepReading).toBe(false);
      expect(lost.failure.message).toStartWith("keyloom lost track of the install");
      expect(retryHelps(lost.failure)).toBe(false);
    }
  });
});

// PR #315 CodeRabbit: the install's state as a reducer, so a stopped poll can't outlive a new install, and the read that lost track picks
// the button, not a failed Cancel shown before it.
describe("installTrack", () => {
  const running = { tool: "docker", status: "running", phase: "installing", logTail: [], error: null } as unknown as InstallState;
  const cancelled = { ...running, status: "cancelled", phase: null } as InstallState;
  const unreadable = { message: "keyloom sent an answer this page can't read.", code: "unreadable" };
  const missed = (track: InstallTrack, failure: PageFailure, times: number) => Array.from({ length: times }).reduce<InstallTrack>((t) => installTrack(t, { kind: "miss", failure }), track);

  test("a start or cancel the server answered starts afresh, so a new install is followed again after reads stopped", () => {
    const stopped = missed(installTrack(INSTALL_IDLE, { kind: "read", state: running }), unreadable, LOST_AFTER);
    expect(stopped.lost?.keepReading).toBe(false);
    const afterCancel = installTrack(stopped, { kind: "read", state: cancelled });
    const restarted = installTrack(installTrack(afterCancel, { kind: "sent" }), { kind: "read", state: running });
    expect(restarted).toMatchObject({ lost: null, misses: 0, failure: null, state: { status: "running" } });
  });

  test("a lost read after a failed Cancel replaces it on screen, and its own code picks the button", () => {
    const failedCancel = installTrack(installTrack(INSTALL_IDLE, { kind: "read", state: running }), { kind: "command_failed", failure: { message: "keyloom isn't answering.", code: "unreachable" } });
    const lost = missed(failedCancel, unreadable, LOST_AFTER);
    expect(lost.failure).toBeNull();
    expect(lost.lost?.failure.code).toBe("unreadable");
    const install: Install = { state: lost.state, problem: lost.lost?.failure.message ?? null, failure: lost.lost?.failure ?? null, lost: lost.lost?.failure ?? null, checkAgain: () => undefined, start: () => undefined, cancel: () => undefined };
    expect(renderToStaticMarkup(createElement(InstallLost, { install }))).toBe("");
    const reachable = missed(failedCancel, { message: "keyloom isn't answering.", code: "unreachable" }, LOST_AFTER);
    expect(renderToStaticMarkup(createElement(InstallLost, { install: { ...install, lost: reachable.lost?.failure ?? null } }))).toContain("Check again");
  });

  test("one or two misses say nothing; Check again's failure says so at once", () => {
    const once = missed(INSTALL_IDLE, unreadable, LOST_AFTER - 1);
    expect(once.lost).toBeNull();
    expect(installTrack(INSTALL_IDLE, { kind: "miss", failure: unreadable, now: true }).lost).not.toBeNull();
  });
});
