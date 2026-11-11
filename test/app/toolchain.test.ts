// What a person sees when the Docker a build needs isn't up (D-486, D-487): readiness names the engine and
// whether keyloom may start it, says where a remote one lives, and offers an install when there is none.
import { describe, expect, test } from "bun:test";
import { dockerAccessFix, dockerAutoStart, dockerReadiness, ensureDocker } from "../../src/app/toolchain.ts";
import type { DockerStatus } from "../../src/firmware/toolchain/docker.ts";

const down: DockerStatus = { ok: false, kind: "daemon-down", reason: "The Docker daemon isn't running." };
const desktop = { kind: "engine" as const, engine: { name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] } };

describe("the setting", () => {
  test("keyloom starts the engine unless the person says otherwise", () => {
    expect(dockerAutoStart({})).toBe(true);
    for (const off of ["0", "false", "no", "off", " OFF "]) expect(dockerAutoStart({ KEYLOOM_DOCKER_AUTOSTART: off })).toBe(false);
    expect(dockerAutoStart({ KEYLOOM_DOCKER_AUTOSTART: "1" })).toBe(true);
  });
});

describe("readiness", () => {
  test("a daemon that is up says so, with no engine to start", async () => {
    const readiness = await dockerReadiness({ status: async () => ({ ok: true, version: "27.4.0" }), env: {} });
    expect(readiness).toMatchObject({ ok: true, version: "27.4.0", autoStart: true });
  });

  test("a closed Docker Desktop is a start away, not a dead end", async () => {
    const readiness = await dockerReadiness({ status: async () => down, detect: async () => desktop, env: {} });
    expect(readiness).toMatchObject({ ok: false, problem: "daemon-down", engine: "Docker Desktop", canStart: true, autoStart: true, install: null });
  });

  test("with starting turned off, the click is what would fix it, so keyloom does not offer to start it", async () => {
    const readiness = await dockerReadiness({ status: async () => down, detect: async () => desktop, env: { KEYLOOM_DOCKER_AUTOSTART: "0" } });
    expect(readiness).toMatchObject({ ok: false, engine: "Docker Desktop", canStart: false, autoStart: false });
  });

  test("an engine on another machine is named as such, with nothing here to start", async () => {
    const readiness = await dockerReadiness({
      status: async () => down, env: {},
      detect: async () => ({ kind: "elsewhere", detail: "Your Docker context \"remote\" points at ssh://builder, which runs on another machine." }),
    });
    expect(readiness).toMatchObject({ ok: false, engine: null, canStart: false });
    if (!readiness.ok) expect(readiness.reason).toContain("another machine");
  });

  test("no Docker at all carries what to install, in this computer's terms", async () => {
    const missing = async () => ({ ok: false as const, kind: "not-installed" as const, reason: "Docker is not on this computer." });
    const withBrew = await dockerReadiness({ status: missing, env: {}, platform: "darwin", has: (c) => c === "brew" });
    expect(withBrew).toMatchObject({ ok: false, problem: "not-installed", engine: null, canStart: false });
    // Homebrew on a Mac: keyloom installs Colima itself (D-488).
    if (!withBrew.ok) expect(withBrew.install).toMatchObject({ engine: "Colima", command: "brew install colima docker", canInstall: true });
    const noBrew = await dockerReadiness({ status: missing, env: {}, platform: "darwin", has: () => false });
    if (!noBrew.ok) expect(noBrew.install).toMatchObject({ engine: "Docker Desktop", url: "https://www.docker.com/products/docker-desktop/", canInstall: false });
  });

  test("an engine whose CLI missed the PATH is a link, not an install", async () => {
    const readiness = await dockerReadiness({ status: async () => ({ ok: false, kind: "cli-missing", reason: "Docker Desktop is installed, but its `docker` command isn't on keyloom's PATH." }), env: {} });
    expect(readiness).toMatchObject({ ok: false, problem: "cli-missing", install: null, canStart: false });
  });
});

describe("a daemon that refuses this account (D-497)", () => {
  const refused = async () => ({ ok: false as const, kind: "no-access" as const, reason: "Docker is running, but your account isn't allowed to use it." });

  test("is never offered a start; Linux gets the docker-group command to copy, a Mac the engine to reopen", async () => {
    const linux = await dockerReadiness({ status: refused, detect: async () => ({ kind: "engine", engine: { name: "the Docker service", command: ["systemctl", "start", "docker"] } }), env: {}, platform: "linux" });
    expect(linux).toMatchObject({ ok: false, problem: "no-access", canStart: false, install: null, access: { command: "sudo usermod -aG docker $USER" } });
    if (!linux.ok) expect(linux.access?.note).toContain("Log out and back in");
    // The command is a privilege grant, so the note says what it grants before the person pastes it.
    if (!linux.ok) expect(linux.access?.note).toContain("root-level access");
    const mac = await dockerReadiness({ status: refused, detect: async () => ({ kind: "engine", engine: { name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] } }), env: {}, platform: "darwin" });
    expect(mac).toMatchObject({ ok: false, problem: "no-access", engine: "Docker Desktop", canStart: false, access: { command: null, note: "Quit Docker Desktop and open it again, then check again." } });
  });

  test("Colima, which has no app to reopen, gets the commands that give its socket back, for its own profile", async () => {
    const colima = await dockerReadiness({ status: refused, detect: async () => ({ kind: "engine", engine: { name: "Colima", command: ["colima", "restart"] } }), env: {}, platform: "darwin" });
    expect(colima).toMatchObject({
      ok: false, problem: "no-access", engine: "Colima", canStart: false,
      access: { command: 'sudo env HOME="$HOME" colima stop; sudo chown -R "$USER" ~/.colima && colima start' },
    });
    if (!colima.ok) expect(colima.access?.note).not.toContain("Quit");
    const work = dockerAccessFix("darwin", { name: "Colima", command: ["colima", "start", "--profile", "work"] });
    expect(work.command).toBe('sudo env HOME="$HOME" colima stop --profile work; sudo chown -R "$USER" ~/.colima && colima start --profile work');
  });

  test("a build says why and starts nothing", async () => {
    let starts = 0;
    const result = await ensureDocker({ overrides: { status: refused, env: {}, startEngine: async () => (starts++, { ok: true, version: "1", engine: "x", waitedMs: 0 }) } });
    expect(result).toMatchObject({ ok: false, engine: null });
    expect(starts).toBe(0);
  });
});

describe("getting it ready for a build", () => {
  test("nothing is started when the daemon is up", async () => {
    let starts = 0;
    const result = await ensureDocker({ overrides: { status: async () => ({ ok: true, version: "27.4.0" }), env: {}, startEngine: async () => (starts++, { ok: true, version: "27.4.0", engine: "Docker Desktop", waitedMs: 0 }) } });
    expect(result).toEqual({ ok: true, started: false, engine: "Docker" });
    expect(starts).toBe(0);
  });

  test("a closed engine is started, and the build log hears about it", async () => {
    const lines: string[] = [];
    const result = await ensureDocker({
      onProgress: (line) => lines.push(line),
      overrides: {
        status: async () => down,
        env: {},
        startEngine: async (opts) => {
          opts?.onProgress?.("keyloom: Docker isn't answering, so starting Docker Desktop");
          return { ok: true, version: "28.0.1", engine: "Docker Desktop", waitedMs: 21_000 };
        },
      },
    });
    expect(result).toEqual({ ok: true, started: true, engine: "Docker Desktop" });
    expect(lines).toEqual(["keyloom: Docker isn't answering, so starting Docker Desktop"]);
  });

  test("a start that fails says why, and the reason is the sentence the person reads", async () => {
    const result = await ensureDocker({
      overrides: { status: async () => down, env: {}, startEngine: async () => ({ ok: false, engine: "Docker Desktop", reason: "Docker Desktop did not answer within 120 s." }) },
    });
    expect(result).toEqual({ ok: false, reason: "Docker Desktop did not answer within 120 s.", engine: "Docker Desktop" });
  });

  test("a computer without docker is told to install it, and nothing is launched", async () => {
    let starts = 0;
    const result = await ensureDocker({
      overrides: { status: async () => ({ ok: false, kind: "not-installed", reason: "Docker is not on this computer. Install Docker Desktop with `brew install --cask docker`." }), env: {}, startEngine: async () => (starts++, { ok: true, version: "1", engine: "Docker Desktop", waitedMs: 0 }) },
    });
    expect(result).toEqual({ ok: false, engine: null, reason: "Docker is not on this computer. Install Docker Desktop with `brew install --cask docker`." });
    expect(starts).toBe(0);
  });

  test("with starting turned off nothing is launched, and the reason names the setting", async () => {
    let starts = 0;
    const result = await ensureDocker({ overrides: { status: async () => down, detect: async () => desktop, env: { KEYLOOM_DOCKER_AUTOSTART: "0" }, startEngine: async () => (starts++, { ok: true, version: "1", engine: "Docker Desktop", waitedMs: 0 }) } });
    expect(starts).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("KEYLOOM_DOCKER_AUTOSTART=0");
  });

  test("with starting turned off, a remote engine still says where it lives", async () => {
    const result = await ensureDocker({
      overrides: {
        status: async () => down, env: { KEYLOOM_DOCKER_AUTOSTART: "0" },
        detect: async () => ({ kind: "elsewhere", detail: "Your Docker context \"remote\" points at ssh://builder, which runs on another machine." }),
        startEngine: async () => ({ ok: true, version: "1", engine: "x", waitedMs: 0 }),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("another machine");
  });
});
