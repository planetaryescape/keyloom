// R5-02: a build that fails the same way every time offers the last version that built and a question to keyloom, never Build again.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Build } from "../../src/api/http.ts";
import { ReleaseDialog } from "../../src/web/release/ReleaseDialog.tsx";
import { buildFailureView, buildQuestion } from "../../src/web/release/build-failure-words.ts";
import type { Release } from "../../src/web/release/useRelease.ts";

const lastBuilt = { revisionId: "rev_A", summary: "Moved Escape to the thumb" };

describe("buildFailureView", () => {
  test("a compile error or a firmware too big goes back to the last revision that built", () => {
    for (const errorCode of ["compile_error", "too_large"] as const) {
      const view = buildFailureView({ errorCode, lastBuilt }, false);
      expect(view).toMatchObject({ kind: "same_every_time", goBack: lastBuilt });
      expect(view.kind === "same_every_time" && view.next).toBe("Building it again fails the same way. The last version that built is “Moved Escape to the thumb”. Going back adds a new revision, so this one stays in History.");
    }
  });
  test("with no earlier revision that built, or a build of an earlier revision from History, there is nothing to go back to", () => {
    expect(buildFailureView({ errorCode: "compile_error", lastBuilt: null }, false)).toMatchObject({ kind: "same_every_time", goBack: null });
    expect(buildFailureView({ errorCode: "too_large", lastBuilt }, true)).toMatchObject({ kind: "same_every_time", goBack: null });
  });
  test("Docker is Docker's callout, and a failure that may pass keeps Build again", () => {
    expect(buildFailureView({ errorCode: "docker_unavailable" }, false)).toEqual({ kind: "docker" });
    expect(buildFailureView({ errorCode: null }, false)).toEqual({ kind: "may_pass" });
  });
});

describe("buildQuestion", () => {
  test("says what failed and carries the log's newest lines in a fence", () => {
    const text = buildQuestion({ boardName: "Moonlander", error: "The generated firmware doesn't compile: 'KC_NOPE' undeclared", logTail: ["one", "two"] });
    expect(text).toStartWith("My firmware build for the Moonlander failed.");
    expect(text).toContain("keyloom said: The generated firmware doesn't compile: 'KC_NOPE' undeclared");
    expect(text).toEndWith("```\none\ntwo\n```");
  });
  test("a long log keeps its newest lines and fits the chat's 8000 characters", () => {
    const logTail = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(200)}`);
    const text = buildQuestion({ boardName: "Glove80", error: null, logTail });
    expect(text.length).toBeLessThanOrEqual(8000);
    expect(text).toContain("line 199");
    expect(text).not.toContain("line 100 ");
    expect(text).toEndWith("```");
  });
});

const noop = () => {};
function release(build: Build): Release {
  return {
    build, flash: null, starting: null, error: null, needsBoardRevision: false, boardRevision: null, chooseBoardRevision: noop, buildNow: noop, flashNow: noop, retry: noop,
    docker: { readiness: { ok: true, version: "29.0", engine: "Colima", autoStart: true }, unanswered: false, starting: false, problem: null, lastAction: null, start: noop, restart: noop, refresh: noop },
    dockerInstall: { state: null, problem: null, start: noop, cancel: noop }, toolInstall: { state: null, problem: null, start: noop, cancel: noop },
    download: noop, reveal: noop, checkBuild: noop, fileProblem: null, cancelBuild: noop, stoppingBuild: false, buildCancelProblem: null,
    cancelFlash: noop, cancelling: false, cancelNote: null, checkKeyboard: noop, check: { running: false, found: null, problem: null }, openSettings: noop, settingsProblem: null,
  } as Release;
}
function failedStep(errorCode: Build["errorCode"], over: Partial<Build> = {}) {
  const build = {
    id: "bld", revisionId: "rev_B", status: "failed", error: "The generated firmware doesn't compile: 'KC_NOPE' undeclared", errorCode, lastBuilt,
    flashPlan: { manual: null, tool: null, canReveal: true }, startedAt: 0, finishedAt: 1, logTail: ["make: *** [keymap.o] Error 1"], artifactPath: null, logPath: "/tmp/x.log", ...over,
  } as Build;
  return renderToStaticMarkup(createElement(ReleaseDialog, {
    open: true, onClose: noop, release: release(build), head: { id: "rev_B", summary: "Added a combo" }, boardName: "Moonlander", boardRevisions: [],
    status: { label: "Build failed", tone: "error" } as never, now: 2, onGoBack: async () => {}, onShowLatest: async () => {}, onAskAboutBuild: noop,
  }));
}

describe("the failed build step", () => {
  test("a compile error offers Go back and Ask keyloom, and no Build again", () => {
    const html = failedStep("compile_error");
    expect(html).toContain("Go back to the last version that built");
    expect(html).toContain("Ask keyloom about this build");
    expect(html).toContain("Building it again fails the same way.");
    expect(html).not.toContain("Build again");
  });
  test("a failure that may pass keeps Build again beside Ask keyloom", () => {
    const html = failedStep(null, { error: "QMK's build failed (exit 2): network" });
    expect(html).toContain("Build again");
    expect(html).toContain("Ask keyloom about this build");
    expect(html).not.toContain("Go back to the last version that built");
  });
});
