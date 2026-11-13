// R5-02: a build that fails the same way every time offers the last version that built and a question to keyloom, never Build again.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Build } from "../../src/api/http.ts";
import { ReleaseDialog } from "../../src/web/release/ReleaseDialog.tsx";
import { ApiError } from "../../src/web/api.ts";
import { buildFailureView, buildQuestion, goBackProblem, restartWaitText, shownGoBackProblem, wentBackSummary } from "../../src/web/release/build-failure-words.ts";
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
  test("a layout keyloom can't write as source fails the same way every time, like a compile error (R7-02)", () => {
    expect(buildFailureView({ errorCode: "source_error", lastBuilt }, false)).toMatchObject({ kind: "same_every_time", goBack: lastBuilt });
  });
  test("a folder the engine doesn't share names the folder and where it is shared, never XDG_CACHE_HOME (R7-02)", () => {
    const folder = "/Volumes/cache/keyloom/build/zsa-moonlander";
    const desktop = buildFailureView({ errorCode: "folder_not_shared", folderNotShared: { folder, engine: "Docker Desktop" } }, false);
    expect(desktop).toEqual({ kind: "folder_not_shared", text: `Docker can't see the folder keyloom builds in (${folder}), so the build stopped before it started.`, next: "Add that folder in Docker Desktop's Settings, under Resources > File sharing, then build again.", openApp: "docker_desktop", helpUrl: null });
    expect(buildFailureView({ errorCode: "folder_not_shared", folderNotShared: { folder, engine: "Colima" } }, false)).toMatchObject({ openApp: null, helpUrl: "https://colima.run/docs/faq/#docker-bind-mount-showing-empty", next: expect.stringContaining("Colima's mounts") });
    expect(buildFailureView({ errorCode: "folder_not_shared", folderNotShared: null }, false)).toMatchObject({ openApp: null, text: expect.stringContaining("the folder keyloom builds in, so"), next: "Share that folder with your Docker engine, then build again." });
  });
  test("Docker is Docker's callout, and a failure that may pass keeps Build again", () => {
    expect(buildFailureView({ errorCode: "docker_unavailable" }, false)).toEqual({ kind: "docker" });
    expect(buildFailureView({ errorCode: null }, false)).toEqual({ kind: "may_pass" });
  });
});

describe("restartWaitText (R7-04)", () => {
  test("names the work it waits for, with the, and says the build follows", () => {
    expect(restartWaitText("Colima", ["a lab analysis"])).toBe("Restarts Colima when the lab analysis ends, then builds again.");
    expect(restartWaitText("Docker Desktop", ["a build", "an emulator run", "a keyboard write"])).toBe("Restarts Docker Desktop when the build, the emulator run and the keyboard write end, then builds again.");
    expect(restartWaitText(null, [])).toBe("Restarts Docker when that work ends, then builds again.");
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
    docker: { readiness: { ok: true, version: "29.0", engine: "Colima", autoStart: true }, unanswered: false, starting: false, problem: null, problemCode: null, linkedFile: null, lastAction: null, start: noop, restart: noop, fixFiles: noop, refresh: noop },
    dockerInstall: { state: null, problem: null, start: noop, cancel: noop }, toolInstall: { state: null, problem: null, start: noop, cancel: noop },
    download: noop, reveal: noop, checkBuild: noop, fileProblem: null, cancelBuild: noop, stoppingBuild: false, buildCancelProblem: null,
    cancelFlash: noop, cancelling: false, cancelNote: null, checkKeyboard: noop, check: { running: false, found: null, problem: null }, openSettings: noop, settingsProblem: null,
    restartAndBuild: noop, engineRestart: { running: false, problem: null, again: true, waitingFor: null, log: [] }, cancelRestartWait: noop, ...over,
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
  test("a layout keyloom can't write as source offers Go back and Ask keyloom, and no Build again (R7-02)", () => {
    const html = failedStep("source_error", { error: "This layout can't be written as QMK source: layer 9 has no name" });
    expect(html).toContain("Go back to the last version that built");
    expect(html).not.toContain("Build again");
  });
  test("a folder Docker Desktop doesn't share offers Open Docker Desktop and Build again, and no XDG advice (R7-02)", () => {
    // What Docker Desktop's refused mount leaves: its own words, then the probe's failure (probeFailure).
    const error = "Docker Desktop doesn't share /x. Allow that folder under Docker Desktop's Settings > Resources > File sharing, or set XDG_CACHE_HOME to a folder it can see.";
    const logTail = ["docker: Error response from daemon: Mounts denied: ", "The path /x is not shared from the host and is not known to Docker.", `keyloom: build failed: ${error}`];
    const html = failedStep("folder_not_shared", { error, folderNotShared: { folder: "/x", engine: "Docker Desktop" }, logTail });
    expect(html).toContain("Open Docker Desktop");
    expect(html).toContain(">Build again<");
    expect(html).toContain("Ask keyloom about this build");
    expect(html).not.toContain("XDG_CACHE_HOME");
    const colima = failedStep("folder_not_shared", { error, folderNotShared: { folder: "/x", engine: "Colima" } });
    expect(colima).not.toContain("Open Docker Desktop");
    expect(colima).toContain("Open Colima&#x27;s guide to mounts");
    expect(colima).toContain("Build again");
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
  test("a restart waiting for work says what it waits for, offers Cancel restart, and no restart button (R7-04)", () => {
    const html = failedStep("stale_mount", { error: stale, restartEngine: "Colima" }, { engineRestart: { running: false, problem: null, again: true, waitingFor: ["a lab analysis"], log: [] } });
    expect(html).toContain("Restarts Colima when the lab analysis ends, then builds again.");
    expect(html).toContain("Cancel restart");
    expect(html).not.toContain("Restart Colima and build again");
  });
  test("a running restart shows its progress in the log tail (R7-04)", () => {
    const html = failedStep("stale_mount", { error: stale, restartEngine: "Colima" }, { engineRestart: { running: true, problem: null, again: true, waitingFor: null, log: ["keyloom: stopping Colima so it starts from scratch"] } });
    expect(html).toContain("Restarting Colima…");
    expect(html).toContain("keyloom: stopping Colima so it starts from scratch");
  });
  test("a restart that left a Mac app down offers the Docker callout's button (R7-03)", () => {
    const down = { ok: false as const, problem: "daemon-down" as const, reason: "Docker isn't answering.", engine: "Docker Desktop", canStart: true, autoStart: true, install: null, access: null, restartEngine: null, alternatives: [], engineAction: null };
    const html = failedStep("stale_mount", { error: stale, restartEngine: "Docker Desktop" }, {
      engineRestart: { running: false, problem: "Docker Desktop didn't come back.", again: false, waitingFor: null, log: [] },
      docker: { readiness: down, unanswered: false, starting: false, problem: null, problemCode: null, linkedFile: false, lastAction: null, start: noop, restart: noop, fixFiles: noop, refresh: noop },
    });
    expect(html).toContain("Build again starts Docker Desktop if it isn&#x27;t running.");
    expect(html).toContain("Start it now");
  });
  test("a restart refused while a build runs keeps the button with its reason; one that failed shows why and Build again", () => {
    const busy = failedStep("stale_mount", { error: stale, restartEngine: "Colima" }, { engineRestart: { running: false, problem: "keyloom is running a build, and restarting Docker now would stop it. Restart Docker once that has finished.", again: true, waitingFor: null, log: [] } });
    expect(busy).toContain("Restart Colima and build again");
    expect(busy).toContain("restarting Docker now would stop it");
    const failed = failedStep("stale_mount", { error: stale, restartEngine: "Colima" }, { engineRestart: { running: false, problem: "Colima didn't start: exit 1", again: false, waitingFor: null, log: [] } });
    expect(failed).not.toContain("Restart Colima and build again");
    expect(failed).toContain("Colima didn&#x27;t start");
    expect(failed).toContain("Build again");
    // The words match the button left: no "Restarting Colima clears this" beside a Build again that hits the same state (PR #297 review).
    // Build again starts the engine itself, so the words point at it, never at a terminal (R7-03).
    expect(failed).toContain("keyloom couldn&#x27;t restart Colima. Build again starts Colima if it isn&#x27;t running.");
    expect(failed).not.toContain("yourself");
    expect(failed).not.toContain("Restarting Colima clears this");
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
