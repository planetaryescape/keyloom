// R5-02: a build that fails the same way every time offers the last version that built and a question to keyloom, never Build again.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Build } from "../../src/api/http.ts";
import { ReleaseDialog } from "../../src/web/release/ReleaseDialog.tsx";
import { ApiError } from "../../src/web/api.ts";
import { buildFailureView, buildQuestion, goBackProblem, shownGoBackProblem, wentBackSummary } from "../../src/web/release/build-failure-words.ts";
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
  test("one huge log line or a huge error never pushes the whole log out", () => {
    const hugeLine = buildQuestion({ boardName: "Glove80", error: "The build failed.", logTail: ["older", `error: ${"y".repeat(20000)}`] });
    expect(hugeLine.length).toBeLessThanOrEqual(8000);
    expect(hugeLine).toContain("```\nolder\nerror: yyy");
    const hugeError = buildQuestion({ boardName: "Glove80", error: "z".repeat(20000), logTail: ["make: *** [keymap.o] Error 1"] });
    expect(hugeError.length).toBeLessThanOrEqual(8000);
    expect(hugeError).toEndWith("```\nmake: *** [keymap.o] Error 1\n```");
    const hugeName = buildQuestion({ boardName: "b".repeat(20000), error: "z".repeat(20000), logTail: ["make: *** [keymap.o] Error 1"] });
    expect(hugeName.length).toBeLessThanOrEqual(8000);
    expect(hugeName).toEndWith("```\nmake: *** [keymap.o] Error 1\n```");
  });
});

const noop = () => {};
function release(build: Build, over: Partial<Release> = {}): Release {
  return {
    build, flash: null, starting: null, error: null, needsBoardRevision: false, boardRevision: null, chooseBoardRevision: noop, buildNow: noop, flashNow: noop, retry: noop,
    docker: { readiness: { ok: true, version: "29.0", engine: "Colima", autoStart: true }, unanswered: false, starting: false, problem: null, problemCode: null, lastAction: null, start: noop, restart: noop, fixFiles: noop, refresh: noop },
    dockerInstall: { state: null, problem: null, start: noop, cancel: noop }, toolInstall: { state: null, problem: null, start: noop, cancel: noop },
    download: noop, reveal: noop, checkBuild: noop, fileProblem: null, cancelBuild: noop, stoppingBuild: false, buildCancelProblem: null,
    cancelFlash: noop, cancelling: false, cancelNote: null, checkKeyboard: noop, check: { running: false, found: null, problem: null }, openSettings: noop, settingsProblem: null,
    restartAndBuild: noop, engineRestart: { running: false, problem: null, again: true }, ...over,
  } as Release;
}
function failedStep(errorCode: Build["errorCode"], over: Partial<Build> = {}, releaseOver: Partial<Release> = {}) {
  const build = {
    id: "bld", revisionId: "rev_B", status: "failed", error: "The generated firmware doesn't compile: 'KC_NOPE' undeclared", errorCode, lastBuilt,
    flashPlan: { manual: null, tool: null, canReveal: true }, startedAt: 0, finishedAt: 1, logTail: ["make: *** [keymap.o] Error 1"], artifactPath: null, logPath: "/tmp/x.log", ...over,
  } as Build;
  return renderToStaticMarkup(createElement(ReleaseDialog, {
    open: true, onClose: noop, release: release(build, releaseOver), head: { id: "rev_B", summary: "Added a combo" }, boardName: "Moonlander", boardRevisions: [],
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

// R6-09, R6-17: a stale shared folder or a stuck container fails every build until the engine restarts.
describe("a build the engine's own state stopped", () => {
  const stale = "Docker still sees an old or missing copy of keymap.c after 30 s. This is a stale shared folder (Colima's sshfs mount); restart it with `colima restart`, or move XDG_CACHE_HOME to a folder it shares reliably, then build again.";
  test("a stale mount offers Restart Colima and build again, never the terminal advice or Build again", () => {
    const html = failedStep("stale_mount", { error: stale, restartEngine: "Colima", logTail: ["keyloom: the container sees a different copy of keymap.c; checking again", `keyloom: build failed: ${stale}`] });
    expect(html).toContain("Restart Colima and build again");
    expect(html).toContain("Docker kept showing the build an old copy of the files keyloom wrote");
    expect(html).not.toContain("XDG_CACHE_HOME");
    expect(html).not.toContain("colima restart");
    expect(html).not.toContain(">Build again<");
    expect(html).toContain("checking again");
  });
  test("a stuck container names the Mac app keyloom restarts", () => {
    const view = buildFailureView({ errorCode: "stuck_container", lastBuilt: null, restartEngine: "Docker Desktop" }, false);
    expect(view).toEqual({ kind: "restart_engine", text: expect.stringContaining("earlier keyloom left running"), next: expect.stringContaining("Restarting Docker Desktop clears this."), button: "Restart Docker Desktop and build again", busy: "Restarting Docker Desktop…" });
  });
  test("an engine keyloom can't restart says so and keeps Build again", () => {
    const html = failedStep("stale_mount", { error: stale, restartEngine: null });
    expect(html).toContain("Restarting your Docker engine clears this.");
    expect(html).toContain("Build again");
    expect(html).not.toContain("and build again</button>");
  });
  test("a restart refused while a build runs keeps the button with its reason; one that failed shows why and Build again", () => {
    const busy = failedStep("stale_mount", { error: stale, restartEngine: "Colima" }, { engineRestart: { running: false, problem: "A build or flash is running, and restarting Docker now would stop it.", again: true } });
    expect(busy).toContain("Restart Colima and build again");
    expect(busy).toContain("restarting Docker now would stop it");
    const failed = failedStep("stale_mount", { error: stale, restartEngine: "Colima" }, { engineRestart: { running: false, problem: "Colima didn't start: exit 1", again: false } });
    expect(failed).not.toContain("Restart Colima and build again");
    expect(failed).toContain("Colima didn&#x27;t start");
    expect(failed).toContain("Build again");
  });
});

describe("a refused Go back", () => {
  test("a request that never reached keyloom, or a server fault, keeps the button so it can be asked again", () => {
    expect(goBackProblem(new ApiError(0, "keyloom isn't answering.", { code: "unreachable" }), "bld")).toMatchObject({ retry: true, next: null, buildId: "bld" });
    expect(goBackProblem(new ApiError(500, "Internal error"), "bld")).toMatchObject({ retry: true });
  });
  test("a refusal about the revision itself hides the button, and a stale head offers the latest version", () => {
    expect(goBackProblem(new ApiError(409, "The rules refuse it.", { code: "invalid_change" }), "bld")).toMatchObject({ retry: false, next: null, text: "The rules refuse it." });
    expect(goBackProblem(new ApiError(409, "stale", { code: "stale_base" }), "bld")).toMatchObject({ retry: false, next: "reload" });
  });
  test("a refusal shows only on the build it was refused on", () => {
    const problem = goBackProblem(new ApiError(409, "The rules refuse it.", { code: "invalid_change" }), "bld_1");
    expect(shownGoBackProblem(problem, "bld_1")).toBe(problem);
    expect(shownGoBackProblem(problem, "bld_2")).toBeNull();
  });
});

describe("the line after a Go back", () => {
  const wentBack = { summary: "Moved Escape to the thumb", buildId: "bld_1", fromHead: "rev_B", toHead: "rev_C" };
  test("shows on the revision the Go back made, before a new build", () => {
    expect(wentBackSummary(wentBack, "bld_1", "rev_C")).toBe("Moved Escape to the thumb");
  });
  test("goes once the layout is edited again, or a new build runs, or the new head isn't read yet", () => {
    expect(wentBackSummary(wentBack, "bld_1", "rev_D")).toBeNull();
    expect(wentBackSummary(wentBack, "bld_2", "rev_C")).toBeNull();
    expect(wentBackSummary({ ...wentBack, toHead: null }, "bld_1", "rev_B")).toBeNull();
  });
});
