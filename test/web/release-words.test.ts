// What the release dialog shows for Docker and the flash step (D-488 to D-490), as plain data.
import { describe, expect, test } from "bun:test";
import type { DockerReadinessResponse } from "../../src/api/system.ts";
import type { InstallState } from "../../src/api/tool-install.ts";
import { buildBlockedReason, dockerView, flashStepView, plain, recheckDocker } from "../../src/web/release/release-words.ts";

const missing = (canInstall: boolean): DockerReadinessResponse => ({
  ok: false, problem: "not-installed", reason: "Docker is not on this computer. Install Colima with `brew install colima docker`.", engine: null, canStart: false, autoStart: true,
  install: canInstall
    ? { engine: "Colima", command: "brew install colima docker", url: "https://colima.run", note: "No app to keep open.", canInstall: true, alternatives: [{ name: "Docker Desktop", url: "https://d" }] }
    : { engine: "Docker Desktop", command: null, url: "https://www.docker.com/products/docker-desktop/", note: "OrbStack works too.", canInstall: false, alternatives: [] },
  access: null,
});
const ready: DockerReadinessResponse = { ok: true, version: "29.0", engine: "Docker", autoStart: true };
const install = (over: Partial<InstallState>): InstallState => ({ tool: "docker", status: "running", phase: "installing", logTail: ["==> Downloading"], error: null, errorCode: null, ...over });

describe("dockerView", () => {
  test("no Docker with Homebrew is the Install button; without it, the download page", () => {
    expect(dockerView(missing(true), false, null, null)).toMatchObject({ kind: "install", engine: "Colima" });
    expect(dockerView(missing(false), false, null, null)).toMatchObject({ kind: "download", url: "https://www.docker.com/products/docker-desktop/" });
  });

  test("an install in progress, failed, and finished each have their own state", () => {
    expect(dockerView(missing(true), false, null, install({}))).toEqual({ kind: "installing", phase: "installing", logTail: ["==> Downloading"] });
    expect(dockerView(missing(true), false, null, install({ phase: "starting" }))).toMatchObject({ kind: "installing", phase: "starting" });
    expect(dockerView(missing(true), false, null, install({ status: "failed", error: "Homebrew stopped with exit code 1.", errorCode: "brew_failed" }))).toMatchObject({ kind: "install-failed", reason: "Homebrew stopped with exit code 1." });
    expect(dockerView(ready, false, null, install({ status: "succeeded", phase: null }))).toEqual({ kind: "installed" });
    // A failed install followed by Docker arriving some other way is simply ready.
    expect(dockerView(ready, false, null, install({ status: "failed" }))).toEqual({ kind: "none" });
  });

  test("a stopped engine is a start, not an install, and an unknown one shows its own sentence without backticks", () => {
    expect(dockerView({ ok: false, problem: "daemon-down", reason: "down", engine: "Colima", canStart: true, autoStart: true, install: null, access: null }, false, null, null)).toEqual({ kind: "down", engine: "Colima", canStart: true, afterInstall: null });
    // A daemon that refuses this account is never a Start button: on Linux the group command to copy, on a Mac the engine to reopen (D-497).
    const refused = (access: { command: string | null; note: string; restartApp: string | null }): DockerReadinessResponse => ({ ok: false, problem: "no-access", reason: "permission denied", engine: "Colima", canStart: false, autoStart: true, install: null, access });
    expect(dockerView(refused({ command: "sudo usermod -aG docker $USER", note: "Log out and back in.", restartApp: null }), false, null, null)).toEqual({ kind: "no-access", command: "sudo usermod -aG docker $USER", note: "Log out and back in.", restartApp: null });
    expect(dockerView(refused({ command: null, note: "Quit Colima and open it again, then check again.", restartApp: null }), false, null, null)).toMatchObject({ kind: "no-access", command: null });
    expect(buildBlockedReason({ kind: "no-access", command: null, note: "", restartApp: null })).toBe("Give keyloom access to Docker first.");
    expect(dockerView({ ok: false, problem: "cli-missing", reason: "its `docker` command isn't on keyloom's PATH", engine: null, canStart: false, autoStart: true, install: null, access: null }, false, null, null)).toEqual({ kind: "other", reason: "its docker command isn't on keyloom's PATH", problem: "cli-missing" });
    expect(dockerView(ready, true, null, null)).toEqual({ kind: "starting", engine: "Docker", verb: "Starting" });
    expect(dockerView(ready, false, "if it fails, run `colima restart`", null)).toEqual({ kind: "start-failed", reason: "if it fails, run colima restart", retry: "start" });
  });

  test("a Colima start that fails after a good install offers the start, and Build stays open (R2-02)", () => {
    const down: DockerReadinessResponse = { ok: false, problem: "daemon-down", reason: "The Docker daemon isn't running.", engine: "Colima", canStart: true, autoStart: true, install: null, access: null };
    const failed = install({ status: "failed", phase: null, error: "Colima did not answer within 960 s.", errorCode: "start_failed" });
    const view = dockerView(down, false, null, failed);
    expect(view).toEqual({ kind: "down", engine: "Colima", canStart: true, afterInstall: { cancelled: false, reason: "Colima did not answer within 960 s." } });
    expect(buildBlockedReason(view)).toBeNull();
    // A start stopped by Cancel after the install is the same way on.
    expect(dockerView(down, false, null, install({ status: "cancelled", phase: null }))).toMatchObject({ kind: "down", afterInstall: { cancelled: true } });
  });

  test("a failed Docker install offers the engines to install by hand beside Try again (R2-05)", () => {
    const view = dockerView(missing(true), false, null, install({ status: "failed", error: "Homebrew stopped with exit code 1.", errorCode: "brew_failed" }));
    expect(view).toMatchObject({ kind: "install-failed", alternatives: [{ name: "Docker Desktop", url: "https://d" }] });
    expect(buildBlockedReason(view)).toBe("Install Docker first.");
  });

  test("an install being cancelled says so, and a cancelled one is the Install button again (R2-08)", () => {
    const stopping = dockerView(missing(true), false, null, install({ phase: "stopping" }));
    expect(stopping).toMatchObject({ kind: "installing", phase: "stopping" });
    expect(buildBlockedReason(stopping)).toBe("Waiting for the install to stop.");
    expect(dockerView(missing(true), false, null, install({ status: "cancelled", phase: null }))).toMatchObject({ kind: "install", stopped: true });
    expect(dockerView(missing(true), false, null, null)).toMatchObject({ kind: "install", stopped: false });
  });

  test("an app whose CLI isn't set up offers to open it, and Build waits for the CLI (R2-07)", () => {
    const cli: DockerReadinessResponse = { ok: false, problem: "cli-missing", reason: "OrbStack is installed, but its `docker` command isn't on keyloom's PATH.", engine: "OrbStack", canStart: false, autoStart: true, install: null, access: null };
    const view = dockerView(cli, false, null, null);
    expect(view).toEqual({ kind: "cli-missing", app: "OrbStack" });
    expect(buildBlockedReason(view)).toBe("Install Docker's command line tools first.");
    expect(recheckDocker(view)).toBe(true);
    expect(dockerView(cli, true, null, null)).toEqual({ kind: "starting", engine: "OrbStack", verb: "Opening" });
  });

  test("a Mac app that refuses keyloom gets Restart, and a failed restart retries the restart (R2-07)", () => {
    const refused: DockerReadinessResponse = { ok: false, problem: "no-access", reason: "refused", engine: "OrbStack", canStart: false, autoStart: true, install: null, access: { command: null, note: "Quit OrbStack and open it again, then check again.", restartApp: "OrbStack" } };
    expect(dockerView(refused, false, null, null)).toMatchObject({ kind: "no-access", restartApp: "OrbStack" });
    expect(dockerView(refused, true, null, null)).toEqual({ kind: "starting", engine: "OrbStack", verb: "Restarting" });
    expect(dockerView(refused, false, "keyloom couldn't quit OrbStack.", null)).toEqual({ kind: "start-failed", reason: "keyloom couldn't quit OrbStack.", retry: "restart" });
  });

  test("an engine keyloom can't start blocks Build, and one that is only slow doesn't", () => {
    const unknown = (problem: "daemon-down" | "slow"): DockerReadinessResponse => ({ ok: false, problem, reason: "Docker isn't answering, and keyloom doesn't know what starts it.", engine: null, canStart: false, autoStart: true, install: null, access: null });
    expect(buildBlockedReason(dockerView(unknown("daemon-down"), false, null, null))).toBe("Start your Docker engine first.");
    expect(buildBlockedReason(dockerView(unknown("slow"), false, null, null))).toBeNull();
  });
});

describe("buildBlockedReason and recheckDocker", () => {
  test("Build firmware waits for an install, never for a stopped engine the build starts itself", () => {
    expect(buildBlockedReason(dockerView(missing(true), false, null, null))).toBe("Install Docker first.");
    expect(buildBlockedReason(dockerView(missing(true), false, null, install({})))).toBe("Waiting for Docker to finish installing.");
    expect(buildBlockedReason({ kind: "down", engine: "Colima", canStart: true, afterInstall: null })).toBeNull();
    expect(buildBlockedReason({ kind: "none" })).toBeNull();
  });

  test("the dialog asks again by itself only while Docker is missing and nothing of its own is running", () => {
    expect(recheckDocker(dockerView(missing(true), false, null, null))).toBe(true);
    expect(recheckDocker(dockerView(missing(false), false, null, null))).toBe(true);
    expect(recheckDocker(dockerView(missing(true), false, null, install({})))).toBe(false);
    expect(recheckDocker({ kind: "none" })).toBe(false);
  });
});

describe("flashStepView", () => {
  test("a manual board gets its file, a missing tool its install, and anything else the Flash button", () => {
    expect(flashStepView({ manual: "Use QMK Toolbox.", tool: null, canReveal: false })).toEqual({ kind: "manual", instructions: "Use QMK Toolbox.", canReveal: false });
    expect(flashStepView({ manual: null, tool: { name: "zapp", installed: false, canInstall: true, url: "https://github.com/zsa/zapp" }, canReveal: true }))
      .toEqual({ kind: "needs-tool", tool: "zapp", name: "Zapp", canInstall: true, url: "https://github.com/zsa/zapp" });
    expect(flashStepView({ manual: null, tool: { name: "zapp", installed: true, canInstall: true, url: "u" }, canReveal: true })).toEqual({ kind: "flash" });
    expect(flashStepView({ manual: null, tool: null, canReveal: true })).toEqual({ kind: "flash" });
  });

  test("plain drops terminal backticks", () => {
    expect(plain("run `keyloom sync`")).toBe("run keyloom sync");
  });
});
