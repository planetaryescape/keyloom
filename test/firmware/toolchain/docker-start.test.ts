// Starting the engine a build needs (D-486, D-487): keyloom finds what runs the daemon here and waits for
// it, so a closed Docker Desktop is a wait rather than a dead end. No test launches an app or talks to a daemon.
import { describe, expect, test } from "bun:test";
import { type DockerContext, type DockerStatus, adoptBundledDockerCli, bundledDockerCli, colimaEngine, dockerInstall, findDockerEngine, startDockerEngine } from "../../../src/firmware/toolchain/docker.ts";
import { fakeBinDir } from "../../helpers/fake-bin.ts";

const down: DockerStatus = { ok: false, kind: "daemon-down", reason: "The Docker daemon isn't running." };
const up = (version = "27.4.0"): DockerStatus => ({ ok: true, version });
const at = (name: string, host: string | null) => (): Promise<DockerContext> => Promise.resolve({ name, host });

/** Answers `states` in order, repeating the last one, so a test writes "still down, then up". */
function scriptedStatus(states: DockerStatus[]): { calls: number; status: () => Promise<DockerStatus> } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    status: async () => states[Math.min(calls++, states.length - 1)] as DockerStatus,
  };
}

describe("finding the engine a context names", () => {
  const none = () => false;
  const both = (app: string) => app === "Docker.app" || app === "OrbStack.app";
  const engineOf = async (over: Parameters<typeof findDockerEngine>[0]) => {
    const found = await findDockerEngine(over);
    return found.kind === "engine" ? found.engine : found;
  };

  test("Docker Desktop and OrbStack are started through their app, named by the context the CLI points at", async () => {
    expect(await engineOf({ platform: "darwin", installed: both, has: none, context: at("orbstack", "unix:///Users/you/.orbstack/run/docker.sock") })).toEqual({ name: "OrbStack", command: ["open", "-a", "OrbStack"] });
    expect(await engineOf({ platform: "darwin", installed: both, has: none, context: at("desktop-linux", "unix:///Users/you/.docker/run/docker.sock") })).toEqual({ name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] });
    // A default context says nothing about which app made it; the apps installed here decide, Docker Desktop first.
    expect(await engineOf({ platform: "darwin", installed: both, has: none, context: at("default", "unix:///var/run/docker.sock") })).toEqual({ name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] });
    expect(await engineOf({ platform: "darwin", installed: (app: string) => app === "OrbStack.app", has: none, context: at("default", "unix:///var/run/docker.sock") })).toEqual({ name: "OrbStack", command: ["open", "-a", "OrbStack"] });
  });

  test("an engine keyloom doesn't ship is still started by its own launcher: Rancher Desktop, Podman, Lima", async () => {
    const rancher = { name: "Rancher Desktop", app: "Rancher Desktop.app" };
    expect(await engineOf({ platform: "darwin", installed: (a: string) => a === rancher.app, has: none, context: at("rancher-desktop", "unix:///Users/you/.rd/docker.sock") }))
      .toEqual({ name: "Rancher Desktop", command: ["open", "-a", "Rancher Desktop"] });
    // Podman Desktop with the podman CLI installed is started by its machine, not by the app.
    expect(await engineOf({ platform: "darwin", installed: none, has: (c: string) => c === "podman", context: at("podman", "unix:///Users/you/.local/share/containers/podman/machine/podman.sock") }))
      .toEqual({ name: "Podman", command: ["podman", "machine", "start"] });
    expect(await engineOf({ platform: "darwin", installed: none, has: (c: string) => c === "limactl", context: at("lima-docker", "unix:///Users/you/.lima/docker/sock/docker.sock") }))
      .toEqual({ name: "Lima", command: ["limactl", "start", "docker"] });
  });

  test("Colima runs where no app bundle does, and Linux names the service with what to do about a password", async () => {
    const colima = await engineOf({
      platform: "darwin", installed: none, has: (c: string) => c === "colima", context: at("colima", "unix:///Users/you/.colima/default/docker.sock"),
      colimaRunning: async () => false,
    });
    expect(colima).toMatchObject({ name: "Colima", command: ["colima", "start"] });
    const linux = await engineOf({ platform: "linux", installed: none, has: (c: string) => c === "systemctl", context: at("default", "unix:///var/run/docker.sock") });
    expect(linux).toMatchObject({ name: "the Docker service", command: ["systemctl", "start", "docker"] });
    expect((linux as { hint: string }).hint).toContain("sudo systemctl start docker");
    // Docker Desktop for Linux is a user service, not the system one.
    const desktopLinux = await engineOf({ platform: "linux", installed: none, has: (c: string) => c === "systemctl", context: at("desktop-linux", "unix:///Users/you/.docker/desktop/docker.sock") });
    expect(desktopLinux).toMatchObject({ name: "Docker Desktop", command: ["systemctl", "--user", "start", "docker-desktop"] });
  });

  test("a Colima VM that is up gets restarted, because start on a wedged daemon changes nothing", async () => {
    const wedged = await colimaEngine({ name: "colima", host: "unix:///Users/you/.colima/default/docker.sock" }, { has: () => true, running: async () => true });
    expect(wedged?.command).toEqual(["colima", "restart"]);
    expect(wedged?.hint).toContain("colima restart");
    const pbs = await colimaEngine({ name: "colima", host: "unix:///Users/you/.colima/pbs/docker.sock" }, { has: () => true, running: async () => false });
    expect(pbs?.command).toEqual(["colima", "start", "--profile", "pbs"]);
    expect(await colimaEngine(null, { has: () => false })).toBeNull();
  });
});

describe("what keyloom says when it can't start it", () => {
  test("a context on another machine is not started from here, and the sentence says where it lives", async () => {
    const found = await findDockerEngine({ platform: "darwin", installed: () => true, has: () => false, context: at("remote", "ssh://builder.example.com") });
    expect(found.kind).toBe("elsewhere");
    if (found.kind === "elsewhere") {
      expect(found.detail).toContain("ssh://builder.example.com");
      expect(found.detail).toContain("another machine");
    }
  });

  test("a local socket from a tool keyloom has never seen is named, not guessed at", async () => {
    const found = await findDockerEngine({ platform: "darwin", installed: () => false, has: () => false, context: at("mytool", "unix:///Users/you/.mytool/docker.sock") });
    expect(found.kind).toBe("unknown");
    if (found.kind === "unknown") {
      expect(found.detail).toContain("mytool");
      expect(found.detail).toContain("doesn't know what starts the engine");
    }
  });

  test("a computer with nothing at all finds nothing", async () => {
    expect(await findDockerEngine({ platform: "darwin", installed: () => false, has: () => false, context: async () => null })).toEqual({ kind: "none" });
    expect(await findDockerEngine({ platform: "win32", installed: () => true, has: () => true, context: at("desktop-linux", null) })).toEqual({ kind: "none" });
  });
});

describe("starting it", () => {
  test("a daemon already up is not started, and nothing waits", async () => {
    const status = scriptedStatus([up()]);
    let launched = 0;
    const result = await startDockerEngine({ status: status.status, detect: async () => ({ kind: "none" }), start: async () => (launched++, { ok: true }), sleep: async () => {} });
    expect(result).toEqual({ ok: true, version: "27.4.0", engine: "the Docker daemon", waitedMs: 0 });
    expect(launched).toBe(0);
  });

  test("a closed engine is started, said so, and the wait ends as soon as it answers", async () => {
    const status = scriptedStatus([down, down, down, up("28.0.1")]);
    const lines: string[] = [];
    const result = await startDockerEngine({
      status: status.status,
      detect: async () => ({ kind: "engine", engine: { name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] } }),
      start: async () => ({ ok: true }),
      sleep: async () => {},
      pollMs: 1,
      onProgress: (line) => lines.push(line),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.engine).toBe("Docker Desktop");
    expect(status.calls).toBe(4);
    expect(lines[0]).toContain("starting Docker Desktop");
    expect(lines.at(-1)).toContain("is up");
  });

  test("a start command that fails gives the reason, and the engine's hint when it has one", async () => {
    const result = await startDockerEngine({
      status: scriptedStatus([down]).status,
      detect: async () => ({ kind: "engine", engine: { name: "the Docker service", command: ["systemctl", "start", "docker"], hint: "if it asked for a password, run `sudo systemctl start docker`" } }),
      start: async () => ({ ok: false, detail: "permission denied" }),
      sleep: async () => {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("couldn't start the Docker service: permission denied");
      expect(result.reason).toContain("sudo systemctl start docker");
    }
  });

  test("an engine that never answers is given up on, with what to do", async () => {
    const result = await startDockerEngine({
      status: scriptedStatus([down]).status,
      detect: async () => ({ kind: "engine", engine: { name: "OrbStack", command: ["open", "-a", "OrbStack"] } }),
      start: async () => ({ ok: true }),
      sleep: async () => {},
      timeoutMs: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("did not answer within 0 s");
  });

  test("an engine keyloom can't start leaves the finding's own sentence, and launches nothing", async () => {
    let launched = 0;
    const remote = await startDockerEngine({
      status: scriptedStatus([down]).status,
      detect: async () => ({ kind: "elsewhere", detail: "Your Docker context \"remote\" points at ssh://builder, which runs on another machine." }),
      start: async () => (launched++, { ok: true }),
      sleep: async () => {},
    });
    expect(remote).toEqual({ ok: false, engine: null, reason: "Your Docker context \"remote\" points at ssh://builder, which runs on another machine." });
    expect(launched).toBe(0);
  });

  test("a computer without docker is told what to install, and no engine is launched", async () => {
    let launched = 0;
    const missing: DockerStatus = { ok: false, kind: "not-installed", reason: "Docker is not on this computer. Install Docker Desktop with `brew install --cask docker` (https://www.docker.com/products/docker-desktop/), then build again." };
    const result = await startDockerEngine({ status: scriptedStatus([missing]).status, detect: async () => ({ kind: "none" }), start: async () => (launched++, { ok: true }), sleep: async () => {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("brew install --cask docker");
    expect(launched).toBe(0);
  });
});

describe("what to install", () => {
  test("Homebrew where it exists, the download page where it doesn't, and the distribution's engine on Linux", () => {
    // Colima with Homebrew (D-488): no password and no app, so keyloom can run it; the apps stay one link away.
    const brew = dockerInstall("darwin", (c) => c === "brew");
    expect(brew).toMatchObject({ engine: "Colima", command: "brew install colima docker", canInstall: true });
    expect(brew.alternatives.map((a) => a.name)).toEqual(["Docker Desktop", "OrbStack"]);
    expect(dockerInstall("darwin", () => false)).toMatchObject({ engine: "Docker Desktop", command: null, canInstall: false, url: "https://www.docker.com/products/docker-desktop/" });
    expect(dockerInstall("linux", (c) => c === "apt-get")).toMatchObject({ engine: "Docker Engine", url: "https://docs.docker.com/engine/install/", canInstall: false });
    expect(dockerInstall("win32", (c) => c === "winget")).toMatchObject({ command: "winget install --id Docker.DockerDesktop -e", canInstall: false });
  });

  test("an engine app's bundled docker command is found and put on the PATH, so no link is needed (R1-11)", () => {
    const desktop = "/Applications/Docker.app/Contents/Resources/bin/docker";
    expect(bundledDockerCli("darwin", (app) => app === "Docker.app", (path) => path === desktop)).toBe(desktop);
    expect(bundledDockerCli("darwin", (app) => app === "Docker.app", () => false)).toBeNull();
    expect(bundledDockerCli("linux", () => true, () => true)).toBeNull();
    // Podman Desktop bundles no docker command, so it is never adopted.
    expect(bundledDockerCli("darwin", (app) => app === "Podman Desktop.app", () => true)).toBeNull();

    const bin = fakeBinDir({ docker: "exit 0" });
    const before = process.env.PATH;
    try {
      expect(adoptBundledDockerCli(() => `${bin}/docker`)).toBe(`${bin}/docker`);
      expect(process.env.PATH?.startsWith(`${bin}:`)).toBe(true);
    } finally {
      process.env.PATH = before;
    }
    expect(adoptBundledDockerCli(() => null)).toBeNull();
  });
});
