// Starting the engine a build needs (D-486, D-487): keyloom finds what runs the daemon here and waits for
// it, so a closed Docker Desktop is a wait rather than a dead end. No test launches an app or talks to a daemon.
import { describe, expect, test } from "bun:test";
import { type DockerContext, type DockerEngine, type DockerStatus, adoptBundledDockerCli, appleScriptApp, bundledDockerCli, cliMissing, colimaEngine, dockerInstall, findDockerEngine, reasonWithHint, restartColima, restartDockerApp, runStart, startDockerEngine, versionFailure } from "../../../src/firmware/toolchain/docker.ts";
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

  test("a docker CLI still on the default socket, beside Colima and no app, is Colima's: its first start never switched the context (R2-02)", async () => {
    const colimaHere = (c: string) => c === "colima" || c === "docker";
    const found = await findDockerEngine({ platform: "darwin", installed: () => false, has: colimaHere, context: at("default", "unix:///var/run/docker.sock"), colimaRunning: async () => false });
    expect(found).toEqual({ kind: "engine", engine: expect.objectContaining({ name: "Colima", command: ["colima", "start"] }) });
    // An installed app still comes first, and an unknown socket under another context name is still named, not given to Colima.
    expect(await findDockerEngine({ platform: "darwin", installed: (app) => app === "OrbStack.app", has: colimaHere, context: at("default", "unix:///var/run/docker.sock") })).toMatchObject({ kind: "engine", engine: { name: "OrbStack" } });
    expect(await findDockerEngine({ platform: "darwin", installed: () => false, has: colimaHere, context: at("mytool", "unix:///Users/you/.mytool/docker.sock") })).toMatchObject({ kind: "unknown" });
    // Without Colima the default socket is still unknown.
    expect(await findDockerEngine({ platform: "darwin", installed: () => false, has: (c) => c === "docker", context: at("default", "unix:///var/run/docker.sock") })).toMatchObject({ kind: "unknown" });
  });

  test("a computer with nothing at all finds nothing", async () => {
    expect(await findDockerEngine({ platform: "darwin", installed: () => false, has: () => false, context: async () => null })).toEqual({ kind: "none" });
    expect(await findDockerEngine({ platform: "win32", installed: () => true, has: () => true, context: at("desktop-linux", null) })).toEqual({ kind: "none" });
  });
});

describe("reading a failed docker version", () => {
  test("permission denied is no-access, with Docker's own fix on Linux; anything else is a daemon that is down", () => {
    const denied = "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get \"http://%2Fvar%2Frun%2Fdocker.sock/v1.47/version\": dial unix /var/run/docker.sock: connect: permission denied";
    expect(versionFailure(denied, "linux")).toMatchObject({ ok: false, kind: "no-access" });
    expect((versionFailure(denied, "linux") as { reason: string }).reason).toContain("sudo usermod -aG docker $USER");
    expect(versionFailure(denied, "darwin")).toMatchObject({ ok: false, kind: "no-access" });
    expect(versionFailure("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?", "linux")).toMatchObject({ kind: "daemon-down" });
    // An unreadable ~/.docker/config.json says "permission denied" too, but the daemon behind it is simply down and keyloom starts it.
    const configWarning = "WARNING: Error loading config file: open /home/me/.docker/config.json: permission denied\nCannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?";
    expect(versionFailure(configWarning, "linux")).toMatchObject({ kind: "daemon-down" });
  });
});

describe("starting it", () => {
  test("a daemon already up is not started, and nothing waits", async () => {
    const status = scriptedStatus([up()]);
    let launched = 0;
    const result = await startDockerEngine({ status: status.status, detect: async () => ({ kind: "none" }), start: async () => (launched++, { ok: true }), sleep: async () => {} });
    // waitedMs reads the real clock, which can tick over a millisecond during the call; nothing waited if it is that small.
    expect(result).toMatchObject({ ok: true, version: "27.4.0", engine: "the Docker daemon" });
    expect(result.ok && result.waitedMs).toBeLessThan(50);
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
      expect(result.reason).toBe("keyloom couldn't start the Docker service: permission denied");
      // The hint is kept apart, so the CLI prints it and the page can offer a button instead (R3-04).
      expect(result.hint).toContain("sudo systemctl start docker");
      expect(reasonWithHint(result)).toContain("permission denied. if it asked for a password");
      expect(result.restartEngine).toBeUndefined();
    }
  });

  test("a Colima start that fails, or never answers, names Colima as the engine to restart (R3-04)", async () => {
    const colima: DockerEngine = { name: "Colima", command: ["colima", "start"], hint: "if it fails, run `colima restart` in a terminal and build again" };
    const failed = await startDockerEngine({ status: scriptedStatus([down]).status, detect: async () => ({ kind: "engine", engine: colima }), start: async () => ({ ok: false, detail: "exit status 1" }), sleep: async () => {} });
    expect(failed).toMatchObject({ ok: false, reason: "keyloom couldn't start Colima: exit status 1", restartEngine: "Colima" });
    const silent = await startDockerEngine({ status: scriptedStatus([down, down]).status, detect: async () => ({ kind: "engine", engine: colima }), start: async () => ({ ok: true }), sleep: async () => {}, timeoutMs: 40 });
    expect(silent).toMatchObject({ ok: false, restartEngine: "Colima" });
    if (!silent.ok) expect(silent.reason).not.toContain("Open it");
    // Started, but still only slow at the deadline: it is up and may be busy, so no restart is offered (#285 review).
    const slow: DockerStatus = { ok: false, kind: "slow", reason: "Docker did not answer within 5 s; it may still be starting." };
    const busy = await startDockerEngine({ status: scriptedStatus([down, slow]).status, detect: async () => ({ kind: "engine", engine: colima }), start: async () => ({ ok: true }), sleep: async () => {}, timeoutMs: 40 });
    expect(busy).toMatchObject({ ok: false, engine: "Colima" });
    if (!busy.ok) {
      expect(busy.restartEngine).toBeUndefined();
      expect(busy.reason).toContain("busy");
    }
  });

  test("Restart Colima stops it hard, then starts it and waits, and its own failure offers no second restart (R3-04)", async () => {
    const commands: string[] = [];
    const lines: string[] = [];
    const engine: DockerEngine = { name: "Colima", command: ["colima", "restart", "--profile", "work"] };
    const ok = await restartColima(engine, {
      stop: async (command) => (commands.push(command.join(" ")), { ok: false, detail: "colima is not running" }),
      start: async (e) => (commands.push(e.command.join(" ")), { ok: true }),
      status: scriptedStatus([{ ok: true, version: "29.0" }]).status,
      sleep: async () => {}, onProgress: (line) => lines.push(line),
    });
    expect(commands).toEqual(["colima stop --force --profile work", "colima start --profile work"]);
    expect(ok).toMatchObject({ ok: true, engine: "Colima" });
    // A stop that fails is said, and the start still runs: a VM that was never up has nothing to stop.
    expect(lines.some((line) => line.includes("didn't stop cleanly"))).toBe(true);
    const failed = await restartColima(engine, { stop: async () => ({ ok: true }), start: async () => ({ ok: false, detail: "exit status 1" }), status: scriptedStatus([down]).status, sleep: async () => {} });
    expect(failed).toMatchObject({ ok: false, reason: "keyloom couldn't start Colima: exit status 1" });
    if (!failed.ok) expect(failed.restartEngine).toBeUndefined();
    expect(await restartColima({ name: "Docker Desktop", command: ["open", "-a", "Docker Desktop"] })).toMatchObject({ ok: false });
  });

  test("an engine that never answers is given up on, with what to do", async () => {
    const result = await startDockerEngine({
      status: scriptedStatus([down]).status,
      detect: async () => ({ kind: "engine", engine: { name: "OrbStack", command: ["open", "-a", "OrbStack"] } }),
      start: async () => ({ ok: true }),
      // A deadline of 0 could pass before or after the launch check depending on the clock; 40 ms leaves room to launch, then runs out.
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      pollMs: 5,
      timeoutMs: 40,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("OrbStack did not answer within 0 s");
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

  test("a slow answer is asked again, not restarted: a busy Colima VM keeps running (D-497)", async () => {
    const slow: DockerStatus = { ok: false, kind: "slow", reason: "Docker did not answer within 5 s; it may still be starting." };
    const colima = { kind: "engine" as const, engine: { name: "Colima", command: ["colima", "restart"] } };
    let launched = 0;
    const answered = await startDockerEngine({ status: scriptedStatus([slow, slow, up()]).status, detect: async () => colima, start: async () => (launched++, { ok: true }), sleep: async () => {}, pollMs: 1 });
    expect(answered.ok).toBe(true);
    expect(launched).toBe(0);
    // Slow until the deadline: still running, so keyloom leaves it alone and says to check again.
    const busy = await startDockerEngine({ status: scriptedStatus([slow]).status, detect: async () => colima, start: async () => (launched++, { ok: true }), sleep: (ms) => Bun.sleep(ms), pollMs: 5, timeoutMs: 40 });
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.reason).toContain("didn't restart it");
    expect(launched).toBe(0);
    // A daemon that then says it is down (the socket refuses) is the evidence a restart is for.
    const stuck = await startDockerEngine({ status: scriptedStatus([slow, down, up()]).status, detect: async () => colima, start: async () => (launched++, { ok: true }), sleep: async () => {}, pollMs: 1 });
    expect(stuck.ok).toBe(true);
    expect(launched).toBe(1);
  });

  test("the launch and the wait share one deadline: a long launch gets the window, and Docker is asked once after it", async () => {
    const budgets: number[] = [];
    const result = await startDockerEngine({
      status: scriptedStatus([down, up("29.1.0")]).status,
      detect: async () => ({ kind: "engine", engine: { name: "Colima", command: ["colima", "start"] } }),
      // A cold `colima start` that runs past the whole window and then succeeds.
      start: async (_engine, budgetMs) => (budgets.push(budgetMs), await Bun.sleep(60), { ok: true }),
      sleep: async () => {},
      timeoutMs: 50,
    });
    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toBeGreaterThan(0);
    expect(budgets[0]).toBeLessThanOrEqual(50);
    expect(result).toMatchObject({ ok: true, version: "29.1.0", engine: "Colima" });
  });

  test("a cancelled build stops the launch command, and the start fails instead of waiting for Docker", async () => {
    const stop = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const result = await startDockerEngine({
      status: scriptedStatus([down, up()]).status,
      detect: async () => ({ kind: "engine", engine: { name: "Colima", command: ["colima", "start"] } }),
      // The launch is cancelled while it runs, and reports success anyway: the cancel still wins.
      start: async (_engine, _budget, signal) => (signals.push(signal), stop.abort(), { ok: true }),
      sleep: async () => {},
      signal: stop.signal,
    });
    expect(signals).toEqual([stop.signal]);
    expect(result).toEqual({ ok: false, engine: "Colima", reason: "Stopped starting Colima." });
  });

  test("the real launch is killed when the signal fires, and counts as failed", async () => {
    const bin = fakeBinDir({ "keyloom-fake-engine": "exec sleep 30" });
    const before = process.env.PATH;
    process.env.PATH = `${bin}:${before}`;
    try {
      const stop = new AbortController();
      setTimeout(() => stop.abort(), 50);
      const started = Date.now();
      const r = await runStart({ name: "Fake", command: ["keyloom-fake-engine"] }, 20_000, stop.signal);
      expect(r).toEqual({ ok: false, detail: "it was stopped" });
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      process.env.PATH = before;
    }
  });

  test("a daemon that refuses this account is not started", async () => {
    let launched = 0;
    const refused = versionFailure("permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock", "linux");
    const result = await startDockerEngine({ status: scriptedStatus([refused]).status, detect: async () => ({ kind: "none" }), start: async () => (launched++, { ok: true }), sleep: async () => {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("sudo usermod -aG docker $USER");
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

describe("an app whose CLI isn't set up (R2-07)", () => {
  const missing: DockerStatus = { ok: false, kind: "cli-missing", app: "OrbStack", reason: "OrbStack is installed, but its `docker` command isn't on keyloom's PATH." };

  test("a start opens the app and waits through its setup until the CLI answers", async () => {
    const status = scriptedStatus([missing, missing, missing, up("28.1")]);
    const launched: string[][] = [];
    const result = await startDockerEngine({ platform: "darwin", status: status.status, detect: async () => { throw new Error("no hunt for an app it already knows"); }, start: async (engine) => (launched.push(engine.command), { ok: true }), sleep: async () => {} });
    expect(launched).toEqual([["open", "-a", "OrbStack"]]);
    expect(result).toMatchObject({ ok: true, engine: "OrbStack", version: "28.1" });
  });

  test("an app that never sets its CLI up ends with what to finish, not a terminal command", async () => {
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const result = await startDockerEngine({ platform: "darwin", timeoutMs: 10_000, status: async () => missing, start: async () => ({ ok: true }), sleep: async (ms) => { now += ms; } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("Finish OrbStack's setup");
        expect(result.reason).not.toContain("`");
      }
    } finally {
      Date.now = realNow;
    }
  });

  test("Podman Desktop, which brings no docker command, names no app to open, so nothing waits for a CLI that never comes", async () => {
    const podman = cliMissing({ name: "Podman Desktop", clis: [] });
    expect(podman).toMatchObject({ ok: false, kind: "cli-missing" });
    expect(podman).not.toHaveProperty("app");
    if (!podman.ok) expect(podman.reason).toContain("doesn't come with a `docker` command");
    expect(cliMissing({ name: "OrbStack", clis: ["/x/docker"] })).toMatchObject({ app: "OrbStack" });
    let launched = 0;
    const result = await startDockerEngine({ platform: "darwin", status: async () => podman, start: async () => (launched++, { ok: true }), sleep: async () => {} });
    expect(result).toMatchObject({ ok: false });
    expect(launched).toBe(0);
  });

  test("off a Mac, or with no app named, it stays a link and nothing is opened", async () => {
    let launched = 0;
    const start = async () => (launched++, { ok: true });
    expect(await startDockerEngine({ platform: "linux", status: async () => missing, start, sleep: async () => {} })).toMatchObject({ ok: false });
    expect(await startDockerEngine({ platform: "darwin", status: async () => ({ ok: false, kind: "cli-missing", reason: "x" }), start, sleep: async () => {} })).toMatchObject({ ok: false, reason: "x" });
    expect(launched).toBe(0);
  });

  test("the bundled CLI is found in the app, then in the folder its setup fills", () => {
    expect(bundledDockerCli("darwin", (app) => app === "OrbStack.app", (path) => path.endsWith("/.orbstack/bin/docker"))).toEndWith("/.orbstack/bin/docker");
    // The app's own copy comes first.
    expect(bundledDockerCli("darwin", (app) => app === "OrbStack.app", () => true)).toBe("/Applications/OrbStack.app/Contents/MacOS/bin/docker");
  });
});

describe("restarting a Mac app that refuses this account (R2-07)", () => {
  const orbstack = { name: "OrbStack", command: ["open", "-a", "OrbStack"] };
  const refused: DockerStatus = { ok: false, kind: "no-access", reason: "refused" };

  test("quits it, waits until it has closed, opens it and waits for Docker", async () => {
    const calls: string[] = [];
    const control = { quit: async (app: string) => (calls.push(`quit ${app}`), { ok: true }), waitClosed: async (app: string) => (calls.push(`closed ${app}`), true) };
    const status = scriptedStatus([down, up("28.2")]);
    const result = await restartDockerApp(orbstack, { control, status: status.status, start: async (engine) => (calls.push(engine.command.join(" ")), { ok: true }), sleep: async () => {} });
    expect(calls).toEqual(["quit OrbStack", "closed OrbStack", "open -a OrbStack"]);
    expect(result).toMatchObject({ ok: true, engine: "OrbStack" });
  });

  test("it opens the app again even while the socket still refuses or answers slowly, and waits through that (#277 review)", async () => {
    const calls: string[] = [];
    const control = { quit: async () => ({ ok: true }), waitClosed: async () => true };
    // The first answer after the quit is the old refusal, then a slow one: neither may leave the app quit.
    const status = scriptedStatus([refused, { ok: false, kind: "slow", reason: "slow" }, refused, up("28.3")]);
    const result = await restartDockerApp(orbstack, { control, status: status.status, start: async (engine) => (calls.push(engine.command.join(" ")), { ok: true }), sleep: async () => {} });
    expect(calls).toEqual(["open -a OrbStack"]);
    expect(result).toMatchObject({ ok: true, engine: "OrbStack", version: "28.3" });
  });

  test("an app that still refuses after the restart says the restart didn't fix it, not to restart it", async () => {
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const control = { quit: async () => ({ ok: true }), waitClosed: async () => true };
      const result = await restartDockerApp(orbstack, { control, timeoutMs: 10_000, status: async () => refused, start: async () => ({ ok: true }), sleep: async (ms) => { now += ms; } });
      expect(result).toMatchObject({ ok: false, engine: "OrbStack" });
      if (!result.ok) {
        expect(result.reason).toContain("keyloom restarted OrbStack, but Docker still refuses");
        expect(result.reason).not.toContain("Quit");
      }
    } finally {
      Date.now = realNow;
    }
  });

  test("AppleScript quits a known app by its bundle id, and anything else by name", () => {
    expect(appleScriptApp("Docker Desktop")).toBe('application id "com.docker.docker"');
    expect(appleScriptApp("OrbStack")).toBe('application id "dev.kdrag0n.MacVirt"');
    expect(appleScriptApp("Rancher Desktop")).toBe('application id "io.rancherdesktop.app"');
    expect(appleScriptApp("Podman Desktop")).toBe('application id "io.podmandesktop.PodmanDesktop"');
    expect(appleScriptApp("Something")).toBe('application "Something"');
  });

  test("an app that won't quit is left alone, with what to do instead", async () => {
    let opened = 0;
    const result = await restartDockerApp(orbstack, { control: { quit: async () => ({ ok: false, detail: "User canceled." }), waitClosed: async () => true }, status: async () => refused, start: async () => (opened++, { ok: true }), sleep: async () => {} });
    expect(result).toMatchObject({ ok: false, engine: "OrbStack" });
    if (!result.ok) expect(result.reason).toContain("Quit it from its menu");
    expect(opened).toBe(0);
  });

  test("an app that is still quitting after the wait isn't opened over itself", async () => {
    let opened = 0;
    const result = await restartDockerApp(orbstack, { control: { quit: async () => ({ ok: true }), waitClosed: async () => false }, status: async () => refused, start: async () => (opened++, { ok: true }), sleep: async () => {} });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("still quitting");
    expect(opened).toBe(0);
  });

  test("only an app is restarted, and the test preload refuses a real osascript", async () => {
    expect(await restartDockerApp({ name: "Colima", command: ["colima", "start"] })).toMatchObject({ ok: false });
    const result = await restartDockerApp(orbstack, { status: async () => refused, start: async () => ({ ok: true }), sleep: async () => {} });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("refusing");
  });
});
