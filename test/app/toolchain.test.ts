// What a person sees when the Docker a build needs isn't up (D-486, D-487): readiness names the engine and
// whether keyloom may start it, says where a remote one lives, and offers an install when there is none.
import { describe, expect, test } from "bun:test";
import { COLIMA_SCAN_INCOMPLETE_HELD, colimaLinkedFileHeld, dockerAccessFix, dockerAutoStart, dockerReadiness, engineActionNow, ensureDocker, forcedRestartEngine, freeBuildCache, restartDocker, startDocker } from "../../src/app/toolchain.ts";
import { dockerAccessDetail } from "../../src/app/doctor.ts";
import { type DockerStatus, findDockerEngine, startDockerEngine } from "../../src/firmware/toolchain/docker.ts";
import { buildBlockedReason, dockerView } from "../../src/web/release/release-words.ts";

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

  // R10-06: the prune's way to make room names Docker Desktop's settings only when readiness names Docker Desktop.
  test("a daemon that is up names the engine behind it, and Docker when it knows none", async () => {
    const up = async () => ({ ok: true as const, version: "27.4.0" });
    expect(await dockerReadiness({ status: up, identify: async () => "Docker Desktop", env: {} })).toMatchObject({ ok: true, engine: "Docker Desktop" });
    expect(await dockerReadiness({ status: up, identify: async () => "Colima", env: {} })).toMatchObject({ engine: "Colima" });
    expect(await dockerReadiness({ status: up, identify: async () => null, env: {} })).toMatchObject({ engine: "Docker" });
    expect(await dockerReadiness({ status: up, identify: async () => { throw new Error("docker info failed"); }, env: {} })).toMatchObject({ ok: true, engine: "Docker" });
  });

  // PR #315 review: an installed app proves nothing about who answers. Naming Docker Desktop for OrbStack's daemon would open and start
  // an app that doesn't run it.
  test("a daemon that is up is never named after an engine app that only happens to be installed", async () => {
    const up = async () => ({ ok: true as const, version: "27.4.0" });
    let detected = false;
    const readiness = await dockerReadiness({ status: up, detect: async () => ((detected = true), desktop), identify: async () => null, env: {} });
    expect(readiness).toMatchObject({ ok: true, engine: "Docker" });
    expect(detected).toBe(false);
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

  test("an app whose CLI isn't set up is named, so the page can offer to open it; a build still doesn't open it (R2-07)", async () => {
    const readiness = await dockerReadiness({ status: async () => ({ ok: false, kind: "cli-missing", app: "OrbStack", reason: "OrbStack is installed, but its `docker` command isn't on keyloom's PATH." }), env: {} });
    expect(readiness).toMatchObject({ ok: false, problem: "cli-missing", engine: "OrbStack", canStart: false });
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
    expect(mac).toMatchObject({ ok: false, problem: "no-access", engine: "Docker Desktop", canStart: false, access: { command: null, note: "Quit Docker Desktop and open it again, then check again.", restartApp: "Docker Desktop" } });
    if (!linux.ok) expect(linux.access?.restartApp).toBeNull();
  });

  test("a restart goes to the Mac engine found; no engine, or not a Mac, says what to do instead (R2-07)", async () => {
    const restarted: string[] = [];
    const restartApp = async (engine: { name: string }) => (restarted.push(engine.name), { ok: true as const, version: "28", engine: engine.name, waitedMs: 1 });
    const app = await restartDocker({ overrides: { platform: "darwin", status: refused, detect: async () => ({ kind: "engine", engine: { name: "OrbStack", command: ["open", "-a", "OrbStack"] } }), restartApp } });
    expect(app).toMatchObject({ ok: true, engine: "OrbStack" });
    // Colima is refused by restartDockerApp itself (docker-start.test.ts); with no engine at all nothing is restarted.
    expect(await restartDocker({ overrides: { platform: "darwin", status: refused, detect: async () => ({ kind: "none" }), restartApp } })).toMatchObject({ ok: false, engine: null });
    const linux = await restartDocker({ overrides: { platform: "linux", status: refused, detect: async () => ({ kind: "engine", engine: { name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] } }), restartApp } });
    expect(linux.ok).toBe(false);
    expect(restarted).toEqual(["OrbStack"]);
  });

  test("a Docker that works, or is only stopped, is never quit: a restart could kill a running build (#277 review)", async () => {
    let restarted = 0;
    const restartApp = async () => (restarted++, { ok: true as const, version: "28", engine: "Docker Desktop", waitedMs: 1 });
    const detect = async () => desktop;
    expect(await restartDocker({ overrides: { platform: "darwin", status: async () => ({ ok: true, version: "28.4" }), detect, restartApp } })).toMatchObject({ ok: true, version: "28.4" });
    const stopped = await restartDocker({ overrides: { platform: "darwin", status: async () => down, detect, restartApp } });
    expect(stopped).toMatchObject({ ok: false });
    if (!stopped.ok) expect(stopped.reason).toContain("a Docker app when it refuses this account");
    expect(restarted).toBe(0);
  });

  test("a forced restart restarts a Colima or Mac app that answers, for a build its state stopped; any other engine is named, not guessed at (R6-09)", async () => {
    const colima = { kind: "engine" as const, engine: { name: "Colima", command: ["colima", "start"] } };
    const restarted: string[] = [];
    const restartColima = async (engine: { name: string }) => (restarted.push(`colima:${engine.name}`), { ok: true as const, version: "29", engine: engine.name, waitedMs: 1 });
    const restartApp = async (engine: { name: string }) => (restarted.push(`app:${engine.name}`), { ok: true as const, version: "29", engine: engine.name, waitedMs: 1 });
    const up = async () => ({ ok: true as const, version: "29" });
    expect(await restartDocker({ force: true, blocker: () => null, overrides: { status: up, detect: async () => colima, restartColima, restartApp } })).toMatchObject({ ok: true, engine: "Colima" });
    expect(await restartDocker({ force: true, blocker: () => null, overrides: { platform: "darwin", status: up, detect: async () => desktop, restartColima, restartApp } })).toMatchObject({ ok: true, engine: "Docker Desktop" });
    const service = { kind: "engine" as const, engine: { name: "the Docker service", command: ["systemctl", "start", "docker"] } };
    const refused = await restartDocker({ force: true, blocker: () => null, overrides: { platform: "linux", status: up, detect: async () => service, restartColima, restartApp } });
    expect(refused).toMatchObject({ ok: false, engine: null });
    expect(restarted).toEqual(["colima:Colima", "app:Docker Desktop"]);
    expect(await forcedRestartEngine({ platform: "linux", detect: async () => desktop })).toBeNull();
    expect((await forcedRestartEngine({ detect: async () => colima }))?.name).toBe("Colima");
  });

  test("a Colima that won't start is stopped and started from scratch; one that answers, or refuses, is left alone (R3-04)", async () => {
    const colima = { kind: "engine" as const, engine: { name: "Colima", command: ["colima", "start", "--profile", "work"], hint: "if it fails, run `colima restart` in a terminal and build again" } };
    const restarted: string[] = [];
    const restartColima = async (engine: { name: string; command: string[] }) => (restarted.push(engine.command.join(" ")), { ok: true as const, version: "29", engine: engine.name, waitedMs: 1 });
    expect(await restartDocker({ overrides: { status: async () => down, detect: async () => colima, restartColima } })).toMatchObject({ ok: true, engine: "Colima" });
    expect(restarted).toEqual(["colima start --profile work"]);
    expect(await restartDocker({ overrides: { status: async () => ({ ok: true, version: "29" }), detect: async () => colima, restartColima } })).toMatchObject({ ok: true, waitedMs: 0 });
    expect(restarted).toHaveLength(1);
    // Readiness says which engine the page may restart, and only for a dead daemon.
    expect(await dockerReadiness({ status: async () => down, detect: async () => colima, env: {} })).toMatchObject({ restartEngine: "Colima" });
    expect(await dockerReadiness({ status: async () => down, detect: async () => desktop, env: {} })).toMatchObject({ restartEngine: null, alternatives: [] });
    // The engines to install instead, for a Colima a restart doesn't bring back (R4-04b): never Colima itself.
    expect(await dockerReadiness({ status: async () => down, detect: async () => colima, env: {}, platform: "darwin", has: () => true })).toMatchObject({
      alternatives: [{ name: "Docker Desktop" }, { name: "OrbStack" }],
    });
  });

  test("a slow Colima is busy, not broken: it is never restarted, so a build running in it survives (D-497, #285 review)", async () => {
    const colima = { kind: "engine" as const, engine: { name: "Colima", command: ["colima", "start"] } };
    const slow = async () => ({ ok: false as const, kind: "slow" as const, reason: "Docker did not answer within 15 s; it may still be starting." });
    let restarted = 0;
    const restartColima = async () => (restarted++, { ok: true as const, version: "29", engine: "Colima", waitedMs: 1 });
    const result = await restartDocker({ overrides: { status: slow, detect: async () => colima, restartColima } });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toContain("may be running a build");
      expect(result.restartEngine).toBeUndefined();
    }
    expect(restarted).toBe(0);
    expect(await dockerReadiness({ status: slow, detect: async () => colima, env: {} })).toMatchObject({ problem: "slow", restartEngine: null });
  });

  test("a build log keeps the engine's terminal hint (R3-04)", async () => {
    const result = await ensureDocker({ overrides: { status: async () => down, env: {}, startEngine: async () => ({ ok: false, engine: "Colima", reason: "keyloom couldn't start Colima: exit status 1", hint: "if it fails, run `colima restart` in a terminal and build again", restartEngine: "Colima" }) } });
    expect(result).toMatchObject({ ok: false, reason: "keyloom couldn't start Colima: exit status 1. if it fails, run `colima restart` in a terminal and build again" });
  });

  test("doctor says the engine's own fix: Colima's commands, the Linux group, or the app to restart (#274)", () => {
    const colima = dockerAccessDetail(dockerAccessFix("darwin", { name: "Colima", command: ["colima", "start"] }));
    expect(colima).toContain('Run `sudo env HOME="$HOME" colima stop');
    expect(colima).not.toContain("Quit");
    const app = dockerAccessDetail(dockerAccessFix("darwin", { name: "OrbStack", command: ["open", "-a", "OrbStack"] }));
    expect(app).toContain("Quit OrbStack and open it again");
    expect(app).toContain("keyloom doctor --restart-docker");
    expect(dockerAccessDetail(dockerAccessFix("linux", null))).toContain("Run `sudo usermod -aG docker $USER`");
  });

  test("doctor says why Colima's command is held back for a linked file, not what the missing command does (#300 third review)", () => {
    const held = dockerAccessDetail({ ...dockerAccessFix("darwin", { name: "Colima", command: ["colima", "start"] }), command: null, linkedFile: "/Users/someone/.colima/x" });
    // The terminal is told where Fix Colima's files is, and given the stop on its own, which changes no owners (R8-10).
    const terminal = " Fix Colima's files is in Build and flash, in `keyloom serve` or the desktop app. If a copy of Colima started with sudo still runs, `sudo env HOME=\"$HOME\" colima stop` stops it without changing any file's owner.";
    expect(held).toBe(`Docker is running, but this account can't open its socket. ${colimaLinkedFileHeld("/Users/someone/.colima/x")}${terminal}`);
    expect(held).not.toContain("This stops that copy");
    // A look that didn't finish holds the command back too, and says so (D-533).
    const unread = dockerAccessDetail({ ...dockerAccessFix("darwin", { name: "Colima", command: ["colima", "start"] }), command: null, scanIncomplete: true });
    expect(unread).toBe(`Docker is running, but this account can't open its socket. ${COLIMA_SCAN_INCOMPLETE_HELD}${terminal}`);
    expect(unread).not.toContain("chown");
    expect(unread).not.toMatch(/keyloom (fix|colima)/);
  });

  test("Colima, which has no app to reopen, gets the commands that give its socket back, for its own profile", async () => {
    const colima = await dockerReadiness({ status: refused, detect: async () => ({ kind: "engine", engine: { name: "Colima", command: ["colima", "restart"] } }), env: {}, platform: "darwin", colimaLinkedScan: async () => ({ kind: "none" }) });
    expect(colima).toMatchObject({
      ok: false, problem: "no-access", engine: "Colima", canStart: false,
      access: { command: 'sudo env HOME="$HOME" colima stop; sudo chown -R "$USER" ~/.colima && colima start' },
    });
    if (!colima.ok) expect(colima.access?.note).not.toContain("Quit");
    const work = dockerAccessFix("darwin", { name: "Colima", command: ["colima", "start", "--profile", "work"] });
    expect(work.command).toBe('sudo env HOME="$HOME" colima stop --profile work; sudo chown -R "$USER" ~/.colima && colima start --profile work');
    // The stop on its own, which changes no owners, for a copy still running while the full command is held (R8-05).
    expect(work.stopCommand).toBe('sudo env HOME="$HOME" colima stop --profile work');
    expect(dockerAccessFix("darwin", { name: "Colima", command: ["colima", "start"] }).stopCommand).toBe('sudo env HOME="$HOME" colima stop');
    expect(dockerAccessFix("darwin", { name: "OrbStack", command: ["open", "-a", "OrbStack"] }).stopCommand).toBeUndefined();
    // A profile from a hand-edited Docker context is quoted in the sudo lines doctor and the page print, so it stays one argument (PR #306 review).
    const odd = dockerAccessFix("darwin", { name: "Colima", command: ["colima", "start", "--profile", "it's; true"] });
    expect(odd.stopCommand).toBe(`sudo env HOME="$HOME" colima stop --profile 'it'\\''s; true'`);
    expect(odd.command).toBe(`sudo env HOME="$HOME" colima stop --profile 'it'\\''s; true'; sudo chown -R "$USER" ~/.colima && colima start --profile 'it'\\''s; true'`);
    const args = await Bun.$`sh -c ${`printf '%s\\n' ${(odd.stopCommand ?? "").replace(/^sudo env HOME="\$HOME" /, "")}`}`.text();
    expect(args.trimEnd().split("\n")).toEqual(["colima", "stop", "--profile", "it's; true"]);
  });

  describe("freeing Docker's build cache (R8-04)", () => {
    const colima = { kind: "engine" as const, engine: { name: "Colima", command: ["colima", "start"] } };
    const gate = () => {
      let open!: () => void;
      const opened = new Promise<void>((resolve) => (open = resolve));
      return { open, opened };
    };
    test("it prunes only when nothing runs, asking inside the lock, and is refused without a check", async () => {
      let prunes = 0;
      const pruneCache = async () => (prunes++, { ok: true as const, freed: "2.1GB" });
      expect(await freeBuildCache({ blocker: () => null, overrides: { pruneCache } })).toEqual({ ok: true, freed: "2.1GB" });
      const running = "keyloom is running a build. Free Docker's build cache once it has finished.";
      expect(await freeBuildCache({ blocker: () => running, overrides: { pruneCache } })).toEqual({ ok: false, reason: running, code: "build_running" });
      expect(await freeBuildCache({ overrides: { pruneCache } })).toMatchObject({ ok: false, code: "build_running" });
      expect(prunes).toBe(1);
    });

    test("it holds the engine: a restart is refused while it runs, it is refused while a restart runs, and a build waits for it", async () => {
      const held = gate();
      const order: string[] = [];
      const pruning = freeBuildCache({ blocker: () => null, overrides: { pruneCache: async () => (await held.opened, order.push("docker builder prune -f"), { ok: true as const, freed: "0B" }) } });
      await Bun.sleep(10);
      expect(engineActionNow()).toBe("prune");
      // Readiness never shows a prune as an engine action: it runs only on a Docker that answers.
      expect(await dockerReadiness({ status: async () => down, detect: async () => colima, env: {} })).toMatchObject({ engineAction: null });
      expect(await restartDocker({ overrides: { status: async () => down, detect: async () => colima } })).toMatchObject({ ok: false, code: "engine_busy", reason: expect.stringContaining("freeing Docker's build cache") });
      expect(await freeBuildCache({ blocker: () => null, overrides: { pruneCache: async () => ({ ok: true as const, freed: null }) } })).toEqual({ ok: false, code: "engine_busy", reason: "keyloom is already freeing Docker's build cache. Free Docker's build cache once that has finished." });
      const building = ensureDocker({ onProgress: (line) => order.push(line), overrides: { env: {}, status: async () => ({ ok: true as const, version: "29" }) } }).then((r) => (order.push(`build proceeds ok=${r.ok}`), r));
      await Bun.sleep(20);
      expect(order).toEqual(["keyloom: waiting for keyloom to finish freeing Docker's build cache"]);
      held.open();
      expect(await pruning).toEqual({ ok: true, freed: "0B" });
      expect(await building).toMatchObject({ ok: true });
      expect(order).toEqual(["keyloom: waiting for keyloom to finish freeing Docker's build cache", "docker builder prune -f", "build proceeds ok=true"]);
      expect(engineActionNow()).toBeNull();
    });
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

describe("after Install Docker, when Colima's first start failed (R2-02, #277 review)", () => {
  // Readiness as the server computes it: Homebrew's docker CLI still on the "default" context, Colima on PATH, no Mac app. Nothing is hand-built.
  const lookup = { platform: "darwin" as const, installed: () => false, has: (c: string) => c === "colima" || c === "docker" || c === "brew", context: async () => ({ name: "default", host: "unix:///var/run/docker.sock" }), colimaRunning: async () => false };
  const failedInstall = { tool: "docker" as const, status: "failed" as const, phase: null, logTail: [], error: "Colima did not answer within 960 s.", errorCode: "start_failed" as const };

  test("readiness names Colima as one keyloom can restart, the page offers Restart Colima, and Build isn't blocked", async () => {
    const readiness = await dockerReadiness({ status: async () => down, detect: () => findDockerEngine(lookup), env: {}, platform: "darwin" });
    expect(readiness).toMatchObject({ ok: false, problem: "daemon-down", engine: "Colima", canStart: true });
    const view = dockerView(readiness, false, null, failedInstall);
    expect(view).toEqual({ kind: "down", engine: "Colima", canStart: true, afterInstall: { cancelled: false, reason: "Colima did not answer within 960 s." }, restartEngine: "Colima" });
    expect(buildBlockedReason(view)).toBeNull();
    const cancelled = dockerView(readiness, false, null, { ...failedInstall, status: "cancelled", error: null, errorCode: null });
    expect(cancelled).toMatchObject({ kind: "down", afterInstall: { cancelled: true } });
  });

  test("Start it now (and --start-docker) start Colima rather than saying keyloom doesn't know the engine", async () => {
    const launched: string[][] = [];
    const result = await startDockerEngine({ status: (() => { let n = 0; return async () => (n++ === 0 ? down : { ok: true as const, version: "29.0" }); })(), detect: () => findDockerEngine(lookup), start: async (engine) => (launched.push(engine.command), { ok: true }), sleep: async () => {} });
    expect(launched).toEqual([["colima", "start"]]);
    expect(result).toMatchObject({ ok: true, engine: "Colima" });
  });
});

describe("one engine action at a time (#285 review)", () => {
  const colima = { kind: "engine" as const, engine: { name: "Colima", command: ["colima", "start"] } };
  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { open, opened };
  };

  test("a restart while a start is running is refused with a reason, so `colima stop --force` can't kill that start", async () => {
    const held = gate();
    const starting = startDocker({ overrides: { startEngine: async () => (await held.opened, { ok: true, version: "29", engine: "Colima", waitedMs: 1 }) } });
    let restarted = 0;
    const restartColima = async () => (restarted++, { ok: true as const, version: "29", engine: "Colima", waitedMs: 1 });
    const refused = await restartDocker({ overrides: { status: async () => down, detect: async () => colima, restartColima } });
    // A code, so the page follows the running start instead of recording a failed restart (R4-04).
    expect(refused).toMatchObject({ ok: false, engine: null, code: "engine_busy" });
    if (!refused.ok) expect(refused.reason).toContain("already starting");
    expect(restarted).toBe(0);
    // Readiness says keyloom is starting it, for the page that didn't start it.
    expect(await dockerReadiness({ status: async () => down, detect: async () => colima, env: {} })).toMatchObject({ engineAction: "start" });
    held.open();
    expect(await starting).toMatchObject({ ok: true });
    expect(await dockerReadiness({ status: async () => down, detect: async () => colima, env: {} })).toMatchObject({ engineAction: null });
    // Once the start has ended, a restart runs.
    expect(await restartDocker({ overrides: { status: async () => down, detect: async () => colima, restartColima } })).toMatchObject({ ok: true });
    expect(restarted).toBe(1);
  });

  test("a build's start waits for a restart to end, then finds Docker up instead of starting it over the restart", async () => {
    const held = gate();
    let up = false;
    const restarting = restartDocker({ overrides: { status: async () => down, detect: async () => colima, restartColima: async () => (await held.opened, up = true, { ok: true, version: "29", engine: "Colima", waitedMs: 1 }) } });
    const order: string[] = [];
    const building = ensureDocker({ overrides: { env: {}, status: async () => (up ? { ok: true, version: "29" } : down), startEngine: async (o) => {
      order.push("start");
      const now = await o?.status?.();
      return now?.ok ? { ok: true, version: now.version, engine: "Colima", waitedMs: 0 } : { ok: false, engine: "Colima", reason: "down" };
    } } });
    await Bun.sleep(20);
    expect(order).toEqual([]);
    held.open();
    expect(await restarting).toMatchObject({ ok: true });
    // It waits before it asks Docker, so it finds the restarted engine up and starts nothing (D-529).
    expect(await building).toMatchObject({ ok: true, started: false });
    expect(order).toEqual([]);
  });

  test("a build that asks for Docker during a forced restart waits for the restart, even though Docker answers (D-529, PR #297 review)", async () => {
    const held = gate();
    const order: string[] = [];
    const up = async () => ({ ok: true as const, version: "29" });
    const restarting = restartDocker({ force: true, blocker: () => null, overrides: { status: async () => (await held.opened, { ok: true, version: "29" }), detect: async () => colima, restartColima: async () => (order.push("colima stop --force"), { ok: true, version: "29", engine: "Colima", waitedMs: 1 }) } });
    await Bun.sleep(10);
    const building = ensureDocker({ onProgress: (line) => order.push(line), overrides: { env: {}, status: up } }).then((r) => (order.push(`build proceeds ok=${r.ok}`), r));
    await Bun.sleep(20);
    // The build log says why it stopped moving.
    expect(order).toEqual(["keyloom: waiting for keyloom to finish restarting Docker"]);
    held.open();
    expect(await restarting).toMatchObject({ ok: true });
    expect(await building).toMatchObject({ ok: true, started: false });
    expect(order).toEqual(["keyloom: waiting for keyloom to finish restarting Docker", "colima stop --force", "build proceeds ok=true"]);
  });

  test("a forced restart asks what is running inside the lock, right before the stop, so work that began after the click is not stopped (D-529)", async () => {
    const held = gate();
    let stopped = 0;
    let running: string | null = null;
    const asked: string[] = [];
    const restarting = restartDocker({
      force: true,
      blocker: () => (asked.push("blocker"), running),
      overrides: { status: async () => ({ ok: true, version: "29" }), detect: async () => (await held.opened, colima), restartColima: async () => (stopped++, { ok: true, version: "29", engine: "Colima", waitedMs: 1 }) },
    });
    await Bun.sleep(10);
    // A build registers itself while the restart is still looking for the engine.
    running = "keyloom is running a build, and restarting Docker now would stop it. Restart Docker once that has finished.";
    expect(asked).toEqual([]);
    held.open();
    expect(await restarting).toMatchObject({ ok: false, engine: null, code: "build_running", reason: running });
    expect(stopped).toBe(0);
    expect(asked).toEqual(["blocker"]);
  });

  test("a forced restart asks what is running before it stops an engine that reads down or refused (PR #297 CodeRabbit)", async () => {
    const running = "keyloom is running a build, and restarting Docker now would stop it. Restart Docker once that has finished.";
    const refused = async (): Promise<DockerStatus> => ({ ok: false, kind: "no-access", reason: "Docker is running, but your account isn't allowed to use it." });
    for (const [status, detect] of [[async () => down, async () => colima], [refused, async () => desktop]] as const) {
      let stopped = 0;
      const stop = async () => (stopped++, { ok: true as const, version: "29", engine: "Colima", waitedMs: 1 });
      const overrides = { platform: "darwin" as const, status, detect, restartColima: stop, restartApp: stop };
      expect(await restartDocker({ force: true, blocker: () => running, overrides })).toMatchObject({ ok: false, code: "build_running", reason: running });
      expect(await restartDocker({ force: true, overrides })).toMatchObject({ ok: false, code: "build_running" });
      expect(stopped).toBe(0);
      // A plain restart of a dead or refusing engine is unchanged, and a forced one that nothing blocks goes on.
      expect(await restartDocker({ overrides })).toMatchObject({ ok: true });
      expect(await restartDocker({ force: true, blocker: () => null, overrides })).toMatchObject({ ok: true });
      expect(stopped).toBe(2);
    }
  });

  test("a forced restart with no way to ask what is running is refused (D-529)", async () => {
    let stopped = 0;
    const result = await restartDocker({ force: true, overrides: { status: async () => ({ ok: true, version: "29" }), detect: async () => colima, restartColima: async () => (stopped++, { ok: true, version: "29", engine: "Colima", waitedMs: 1 }) } });
    expect(result).toMatchObject({ ok: false, code: "build_running" });
    expect(stopped).toBe(0);
  });

  test("a cancelled build stops waiting for the engine", async () => {
    const held = gate();
    const starting = startDocker({ overrides: { startEngine: async () => (await held.opened, { ok: true, version: "29", engine: "Colima", waitedMs: 1 }) } });
    const control = new AbortController();
    let started = 0;
    const building = ensureDocker({ signal: control.signal, overrides: { env: {}, status: async () => down, startEngine: async () => (started++, { ok: true, version: "29", engine: "Colima", waitedMs: 0 }) } });
    control.abort();
    expect(await building).toMatchObject({ ok: false });
    expect(started).toBe(0);
    held.open();
    await starting;
  });
});
