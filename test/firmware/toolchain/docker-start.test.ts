// Starting the engine a build needs (D-486): keyloom finds what runs the daemon here and waits for it, so a
// closed Docker Desktop is a wait rather than a dead end. No test launches an app or talks to a real daemon.
import { describe, expect, test } from "bun:test";
import { type DockerStatus, colimaEngine, detectDockerEngine, startDockerEngine } from "../../../src/firmware/toolchain/docker.ts";

const down: DockerStatus = { ok: false, kind: "daemon-down", reason: "the docker daemon isn't running; start Docker Desktop" };
const up = (version = "27.4.0"): DockerStatus => ({ ok: true, version });

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

describe("finding the engine", () => {
  const none = () => false;
  const dockerDesktop = (app: string) => app === "Docker.app";

  test("macOS starts the app the docker context points at, and falls back to the bundle it finds", async () => {
    const both = { platform: "darwin" as const, installed: (app: string) => app === "Docker.app" || app === "OrbStack.app", has: none };
    expect(await detectDockerEngine({ ...both, context: async () => "orbstack" })).toEqual({ name: "OrbStack", command: ["open", "-a", "OrbStack"] });
    expect(await detectDockerEngine({ ...both, context: async () => "desktop-linux" })).toEqual({ name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] });
    expect(await detectDockerEngine({ ...both, context: async () => null })).toEqual({ name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] });
    expect(await detectDockerEngine({ platform: "darwin", installed: dockerDesktop, has: none, context: async () => "colima" })).toEqual({ name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] });
  });

  test("Colima runs where no app bundle does, and Linux names the service with what to do about a password", async () => {
    const colima = await detectDockerEngine({
      platform: "darwin", installed: none, has: none, context: async () => "colima",
      colima: async () => ({ name: "Colima", command: ["colima", "start"] }),
    });
    expect(colima).toMatchObject({ name: "Colima", command: ["colima", "start"] });
    const linux = await detectDockerEngine({ platform: "linux", installed: none, has: (c: string) => c === "systemctl", context: async () => null });
    expect(linux?.command).toEqual(["systemctl", "start", "docker"]);
    expect(linux?.hint).toContain("sudo systemctl start docker");
    expect(await detectDockerEngine({ platform: "linux", installed: none, has: none, context: async () => null, colima: async () => null })).toBeNull();
  });

  test("a Colima VM that is up gets restarted, because start on a wedged daemon changes nothing", async () => {
    const socket = "unix:///Users/you/.colima/pbs/docker.sock";
    const stopped = await colimaEngine("colima", { has: () => true, host: async () => socket, running: async () => false });
    expect(stopped?.command).toEqual(["colima", "start", "--profile", "pbs"]);
    const wedged = await colimaEngine("colima", { has: () => true, host: async () => "unix:///Users/you/.colima/default/docker.sock", running: async () => true });
    expect(wedged?.command).toEqual(["colima", "restart"]);
    expect(wedged?.hint).toContain("colima restart");
    expect(await colimaEngine("colima", { has: () => false })).toBeNull();
  });
});

describe("starting it", () => {
  test("a daemon already up is not started, and nothing waits", async () => {
    const status = scriptedStatus([up()]);
    let launched = 0;
    const result = await startDockerEngine({ status: status.status, detect: async () => null, start: async () => (launched++, { ok: true }), sleep: async () => {} });
    expect(result).toEqual({ ok: true, version: "27.4.0", engine: "the Docker daemon", waitedMs: 0 });
    expect(launched).toBe(0);
  });

  test("a closed engine is started, said so, and the wait ends as soon as it answers", async () => {
    const status = scriptedStatus([down, down, down, up("28.0.1")]);
    const lines: string[] = [];
    const result = await startDockerEngine({
      status: status.status,
      detect: async () => ({ name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] }),
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
      detect: async () => ({ name: "the Docker service", command: ["systemctl", "start", "docker"], hint: "if it asked for a password, run `sudo systemctl start docker`" }),
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
      detect: async () => ({ name: "OrbStack", command: ["open", "-a", "OrbStack"] }),
      start: async () => ({ ok: true }),
      sleep: async () => {},
      timeoutMs: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("did not answer within 0 s");
  });

  test("a computer without docker is not told to start something, and no engine is launched", async () => {
    let launched = 0;
    const result = await startDockerEngine({
      status: scriptedStatus([{ ok: false, kind: "not-installed", reason: "docker is not on PATH; install Docker Desktop or OrbStack" }]).status,
      detect: async () => null,
      start: async () => (launched++, { ok: true }),
      sleep: async () => {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("install Docker Desktop");
    expect(launched).toBe(0);
  });
});
