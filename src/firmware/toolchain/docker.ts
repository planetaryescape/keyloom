// Docker checks: is the daemon up, how much room does its VM have (S7: a full Docker Desktop
// disk fails a build late, with "No space left on device"), and what starts it when it isn't.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { capture, which } from "./run.ts";

/**
 * `daemon-down` is the one a start fixes; `slow` may still come up. `not-installed` has no engine at all,
 * and `cli-missing` has one whose `docker` command never reached keyloom's PATH: the fix is a link, not an install.
 * `no-access` is a daemon that is there but refuses this account its socket: a start can't fix that (D-497).
 */
export type DockerProblem = "not-installed" | "cli-missing" | "daemon-down" | "slow" | "no-access";

/** On Linux the daemon's socket belongs to the `docker` group; joining it is Docker's documented fix, and it needs a new login. */
export const DOCKER_GROUP_COMMAND = "sudo usermod -aG docker $USER";

export type DockerStatus = { ok: true; version: string } | { ok: false; kind: DockerProblem; reason: string };

const hasCommand = (command: string): boolean => which(command) !== null;

export async function dockerStatus(timeoutMs = 15_000): Promise<DockerStatus> {
  if (!which("docker") && adoptBundledDockerCli() === null) {
    const app = installedEngineApp();
    return app === null
      ? { ok: false, kind: "not-installed", reason: `Docker is not on this computer. ${installSentence()}` }
      : { ok: false, kind: "cli-missing", reason: `${app.name} is installed, but its \`docker\` command isn't on keyloom's PATH. ${cliFix(app)}` };
  }
  const r = await capture(["docker", "version", "--format", "{{.Server.Version}}"], { timeoutMs });
  if (r.timedOut) return { ok: false, kind: "slow", reason: `Docker did not answer within ${Math.round(timeoutMs / 1000)} s; it may still be starting.` };
  if (r.exitCode !== 0) return versionFailure(`${r.stderr}\n${r.stdout}`);
  return { ok: true, version: r.stdout.trim() };
}

/**
 * Why `docker version` failed, from what it printed: the exit code is 1 for a stopped daemon and for a socket this account may not
 * open alike. "permission denied" is the CLI's own wording for the second (docs.docker.com/engine/install/linux-postinstall).
 */
export function versionFailure(output: string, platform: NodeJS.Platform = process.platform): DockerStatus {
  // Only the socket's own error counts: the CLI also says "permission denied" when ~/.docker/config.json is unreadable (a root-owned file
  // after `sudo docker login`), and a stopped daemon behind that warning still needs starting.
  if (!/(permission denied while trying to connect to the docker|connect: permission denied)/i.test(output)) return { ok: false, kind: "daemon-down", reason: "The Docker daemon isn't running." };
  return {
    ok: false, kind: "no-access",
    reason: platform === "linux"
      ? `Docker is running, but your account isn't allowed to use it. Add yourself to the docker group with \`${DOCKER_GROUP_COMMAND}\`, then log out and back in, and start keyloom again.`
      : "Docker is running, but keyloom isn't allowed to open its socket. Quit your Docker app and open it again, then check again.",
  };
}

export const LOW_DISK_BYTES = 15 * 1024 ** 3;

export type DockerDisk = { freeBytes: number } | { unknown: string };

/** Free bytes on the Docker VM's disk, measured with an image that is already local (`--pull=never`, so a check never downloads). */
export async function dockerFreeSpace(images: readonly string[], timeoutMs = 30_000): Promise<DockerDisk> {
  for (const image of images) {
    const r = await capture(["docker", "run", "--rm", "--pull=never", "--entrypoint", "df", image, "-Pk", "/"], { timeoutMs });
    if (r.exitCode !== 0) continue;
    const free = parseDfFreeBytes(r.stdout);
    if (free !== undefined) return { freeBytes: free };
  }
  return { unknown: "no image is local yet to measure with; it is checked after the first build" };
}

/** `df -Pk /` output to available bytes. */
export function parseDfFreeBytes(output: string): number | undefined {
  const row = output.trim().split("\n").at(-1)?.trim().split(/\s+/);
  const availableKb = Number(row?.[3]);
  return Number.isFinite(availableKb) && row && row.length >= 6 ? availableKb * 1024 : undefined;
}

// ---------------------------------------------------------------------------------------------------
// Starting the engine. A build that stops because Docker Desktop is closed is a dead end for the person:
// they closed an app they did not know was involved. keyloom starts the engine it finds, says so in the
// build log, and waits for it (D-486), whoever makes that engine (D-487).

/** The thing that runs the daemon on this computer, in the person's words, and how to start it. */
export type DockerEngine = {
  /** Such as "Docker Desktop". */
  name: string;
  /** The command that starts it; `open -a Docker` on macOS, `colima start`, or the service. */
  command: string[];
  /** What to do when the command ran but the daemon stayed down, such as a permission the person must grant. */
  hint?: string;
};

/** The docker CLI's current context, which names what runs the daemon. */
export type DockerContext = { name: string; host: string | null };

/**
 * What keyloom found when it looked for something to start. `elsewhere` and `unknown` both mean keyloom
 * can't start this one, and each says what would fix it instead of guessing at a command.
 */
export type EngineFinding =
  | { kind: "engine"; engine: DockerEngine }
  /** The context points at another machine or a URL: nothing on this computer to start. */
  | { kind: "elsewhere"; detail: string }
  /** A local socket whose engine keyloom doesn't recognise, such as a tool it has never launched. */
  | { kind: "unknown"; detail: string }
  /** No engine found at all. */
  | { kind: "none" };

/** What a start attempt found. `waitedMs` is how long the engine took to answer. */
export type DockerStartResult =
  | { ok: true; version: string; engine: string; waitedMs: number }
  | { ok: false; engine: string | null; reason: string };

/** Another engine the person may prefer to the one keyloom installs, with the page that installs it. */
export type DockerAlternative = { name: string; url: string };

/**
 * What to install where there is no Docker, per platform; the UI and doctor both read it. `canInstall` is true only
 * where keyloom can run `command` itself with no password or app to click through: Homebrew on a Mac (D-488).
 */
export type DockerInstall = { engine: string; command: string | null; url: string; note: string; canInstall: boolean; alternatives: DockerAlternative[] };

const DOCKER_DESKTOP_URL = "https://www.docker.com/products/docker-desktop/";
const ENGINE_DOCS_URL = "https://docs.docker.com/engine/install/";

const ORBSTACK_URL = "https://orbstack.dev/download";
const COLIMA_URL = "https://colima.run";
/** What keyloom installs on a Mac with Homebrew (D-488): headless, open source, and no admin password. */
export const DOCKER_BREW_FORMULAE = ["colima", "docker"] as const;

export function dockerInstall(platform: NodeJS.Platform = process.platform, has: (command: string) => boolean = hasCommand): DockerInstall {
  if (platform === "darwin") {
    // Docker Desktop's cask can ask for an admin password, which a server can't answer; Colima's formulae never do.
    return has("brew")
      ? {
          engine: "Colima", command: `brew install ${DOCKER_BREW_FORMULAE.join(" ")}`, url: COLIMA_URL, canInstall: true,
          note: "Colima runs Docker in the background, with no app to keep open.",
          alternatives: [{ name: "Docker Desktop", url: DOCKER_DESKTOP_URL }, { name: "OrbStack", url: ORBSTACK_URL }],
        }
      : {
          // OrbStack is named once, as a link: the note would repeat it.
          engine: "Docker Desktop", command: null, url: DOCKER_DESKTOP_URL, canInstall: false, note: "",
          alternatives: [{ name: "OrbStack", url: ORBSTACK_URL }],
        };
  }
  if (platform === "win32") {
    return has("winget")
      ? { engine: "Docker Desktop", command: "winget install --id Docker.DockerDesktop -e", url: DOCKER_DESKTOP_URL, canInstall: false, alternatives: [], note: "Windows builds are not available in keyloom yet (D-435); Docker is only needed for the board review's activity tests." }
      : { engine: "Docker Desktop", command: null, url: DOCKER_DESKTOP_URL, canInstall: false, alternatives: [], note: "Windows builds are not available in keyloom yet (D-435)." };
  }
  return has("apt-get") || has("dnf") || has("pacman")
    ? { engine: "Docker Engine", command: null, url: ENGINE_DOCS_URL, canInstall: false, alternatives: [], note: "Install it from your distribution's packages, or use Docker Desktop for Linux." }
    : { engine: "Docker Engine", command: null, url: ENGINE_DOCS_URL, canInstall: false, alternatives: [], note: "Install Docker Engine for your distribution, or Docker Desktop for Linux." };
}

function installSentence(platform: NodeJS.Platform = process.platform, has: (command: string) => boolean = hasCommand): string {
  const install = dockerInstall(platform, has);
  return `Install ${install.engine}${install.command === null ? "" : ` with \`${install.command}\``} (${install.url}), then build again.`;
}

/**
 * macOS runs Docker inside an app, and some of them install their `docker` command outside keyloom's PATH
 * (a GUI launch, a shell that never opened the app's setup). Naming the app turns "install Docker" into a link.
 */
const ENGINE_APPS: ReadonlyArray<{ name: string; app: string; contexts: readonly string[]; hosts: RegExp; cli?: string }> = [
  { name: "Docker Desktop", app: "Docker.app", contexts: ["desktop-linux"], hosts: /\/\.docker\/run\/docker\.sock$|^unix:\/\/\/var\/run\/docker\.sock$|Docker\.app/, cli: "/Applications/Docker.app/Contents/Resources/bin/docker" },
  { name: "OrbStack", app: "OrbStack.app", contexts: ["orbstack"], hosts: /\/\.orbstack\//, cli: "/Applications/OrbStack.app/Contents/MacOS/bin/docker" },
  { name: "Rancher Desktop", app: "Rancher Desktop.app", contexts: ["rancher-desktop"], hosts: /\/\.rd\//, cli: "/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/bin/docker" },
  { name: "Podman Desktop", app: "Podman Desktop.app", contexts: ["podman", "podman-desktop"], hosts: /podman\.sock$/ },
];

/** A macOS app is installed when one of the two Applications folders holds it. */
function appInstalled(app: string): boolean {
  return existsSync(join("/Applications", app)) || existsSync(join(homedir(), "Applications", app));
}

/** The engine app installed on a Mac, in a fixed order, or null. */
function installedEngineApp(): (typeof ENGINE_APPS)[number] | null {
  if (process.platform !== "darwin") return null;
  return ENGINE_APPS.find((entry) => appInstalled(entry.app)) ?? null;
}

/**
 * The `docker` command an installed engine app bundles, or null. A GUI launch, or a shell that never ran the app's setup,
 * leaves it off the PATH, though keyloom knows where it is (R1-11).
 */
export function bundledDockerCli(
  platform: NodeJS.Platform = process.platform,
  installed: (app: string) => boolean = appInstalled,
  exists: (path: string) => boolean = existsSync,
): string | null {
  if (platform !== "darwin") return null;
  for (const entry of ENGINE_APPS) {
    if (entry.cli !== undefined && installed(entry.app) && exists(entry.cli)) return entry.cli;
  }
  return null;
}

/**
 * Puts the bundled CLI's folder on this process's PATH, so every later `docker` call (and the credential helpers
 * beside it) resolves with no step from the person. Returns the CLI it adopted, or null when there is none.
 */
export function adoptBundledDockerCli(find: () => string | null = () => bundledDockerCli()): string | null {
  const cli = find();
  if (cli === null) return null;
  process.env.PATH = `${dirname(cli)}:${process.env.PATH ?? ""}`;
  return which("docker") === null ? null : cli;
}

/** What to do about an engine whose CLI keyloom couldn't find, even bundled in the app. */
function cliFix(app: (typeof ENGINE_APPS)[number]): string {
  if (app.name === "OrbStack") return "Open OrbStack once and run `orb setup`, or add ~/.orbstack/bin to your PATH, then try again.";
  return "Open it and install its command line tools, then try again.";
}

/**
 * The `docker` CLI's current context names which engine it would talk to ("desktop-linux", "colima"),
 * which picks between two installed engines. It reads local config, so it answers with the daemon down.
 */
async function readContext(has: (command: string) => boolean): Promise<DockerContext | null> {
  if (!has("docker")) return null;
  const shown = await capture(["docker", "context", "show"], { timeoutMs: 5_000 });
  const name = shown.exitCode === 0 ? shown.stdout.trim() : "";
  if (name === "") return null;
  const inspected = await capture(["docker", "context", "inspect", name, "--format", "{{.Endpoints.docker.Host}}"], { timeoutMs: 5_000 });
  const host = inspected.exitCode === 0 ? inspected.stdout.trim() : "";
  return { name, host: host === "" ? null : host };
}

/** A context that names another machine, a port or a URL: an engine keyloom can't start from here. */
const ELSEWHERE = /^(ssh|https?|npipe):\/\/|^tcp:\/\/(?!127\.0\.0\.1|localhost|\[::1\])/;

/**
 * Colima runs Docker inside a VM. When the VM is up but the daemon inside it is wedged (a stale socket,
 * an engine that stopped with the VM), `colima start` says "already running" and changes nothing, so a
 * running VM is restarted instead; that is the fix recorded in docs/research/workload-evaluator.md.
 */
export async function colimaEngine(context: DockerContext | null, over: { has?: (command: string) => boolean; running?: (profile: string) => Promise<boolean> } = {}): Promise<DockerEngine | null> {
  const has = over.has ?? hasCommand;
  if (!has("colima")) return null;
  const profile = context?.host?.match(/\/\.colima\/([^/]+)\/docker\.sock/)?.[1] ?? null;
  const running = over.running ?? (async (name: string) => {
    const r = await capture(["colima", "list", "--json"], { timeoutMs: 10_000 });
    if (r.exitCode !== 0) return false;
    // One JSON object per line, one per profile.
    return r.stdout.split("\n").some((line) => {
      try {
        const row = JSON.parse(line) as { name?: string; status?: string };
        return row.name === name && row.status === "Running";
      } catch {
        return false;
      }
    });
  });
  const profileArgs = profile === null || profile === "default" ? [] : ["--profile", profile];
  const up = await running(profile ?? "default");
  return {
    name: "Colima",
    command: ["colima", up ? "restart" : "start", ...profileArgs],
    hint: "if it fails, run `colima restart` in a terminal and build again",
  };
}

export type EngineLookup = {
  platform?: NodeJS.Platform;
  installed?: (app: string) => boolean;
  has?: (command: string) => boolean;
  /** The CLI's context; injected so a test never runs docker. */
  context?: () => Promise<DockerContext | null>;
  colimaRunning?: (profile: string) => Promise<boolean>;
};

/** The engine a known context or socket names, in the order that names it most exactly. Null when none recognises it. */
async function knownEngine(context: DockerContext | null, platform: NodeJS.Platform, deps: { installed: (app: string) => boolean; has: (command: string) => boolean; colimaRunning?: (profile: string) => Promise<boolean> }): Promise<DockerEngine | null> {
  const name = context?.name ?? "";
  const host = context?.host ?? "";
  const { installed, has } = deps;

  if (/colima/.test(name) || /\/\.colima\//.test(host)) return colimaEngine(context, { has, ...(deps.colimaRunning === undefined ? {} : { running: deps.colimaRunning }) });

  if (platform === "linux") {
    if (/desktop-linux/.test(name) && has("systemctl")) {
      return { name: "Docker Desktop", command: ["systemctl", "--user", "start", "docker-desktop"], hint: "if it fails, open Docker Desktop and wait for it to say it is running" };
    }
    if (/rancher-desktop/.test(name) && has("systemctl")) {
      return { name: "Rancher Desktop", command: ["systemctl", "--user", "start", "rancher-desktop"] };
    }
    if (has("systemctl")) {
      return {
        name: "the Docker service",
        command: ["systemctl", "start", "docker"],
        hint: "if it asked for a password, run `sudo systemctl start docker` in a terminal and build again",
      };
    }
    return colimaEngine(context, { has, ...(deps.colimaRunning === undefined ? {} : { running: deps.colimaRunning }) });
  }

  // Lima exposes each VM's daemon as `~/.lima/<vm>/sock/docker.sock`; only its own CLI starts one.
  const lima = host.match(/\/\.lima\/([^/]+)\/sock\/docker\.sock/)?.[1];
  if (lima !== undefined && has("limactl")) return { name: "Lima", command: ["limactl", "start", lima] };

  const byName = ENGINE_APPS.find((app) => app.contexts.includes(name));
  const byHost = ENGINE_APPS.find((app) => app.hosts.test(host) && (installed(app.app) || app.name === "Docker Desktop"));
  const app = byName ?? byHost;
  if (app !== undefined && installed(app.app)) return { name: app.name, command: ["open", "-a", app.name] };
  if (app?.name === "Podman Desktop" && has("podman")) return { name: "Podman", command: ["podman", "machine", "start"] };
  return null;
}

/**
 * Finds what starts the daemon here. A Mac or Linux computer is asked where its docker CLI points; when that
 * names nothing, the engines installed here are the last answer. Overridable so a test never launches an app.
 */
export async function findDockerEngine(over: EngineLookup = {}): Promise<EngineFinding> {
  const platform = over.platform ?? process.platform;
  const installed = over.installed ?? appInstalled;
  const has = over.has ?? hasCommand;
  if (platform !== "darwin" && platform !== "linux") return { kind: "none" };

  const context = await (over.context ?? (() => readContext(has)))();
  if (context?.host != null && ELSEWHERE.test(context.host)) {
    return {
      kind: "elsewhere",
      detail: `Your Docker context "${context.name}" points at ${context.host}, which runs on another machine. Start its engine there; keyloom starts only the one on this computer.`,
    };
  }

  const engine = await knownEngine(context, platform, { installed, has, ...(over.colimaRunning === undefined ? {} : { colimaRunning: over.colimaRunning }) });
  if (engine !== null) return { kind: "engine", engine };

  const app = platform === "darwin" ? ENGINE_APPS.find((entry) => installed(entry.app)) : undefined;
  if (app !== undefined) return { kind: "engine", engine: { name: app.name, command: ["open", "-a", app.name] } };

  if (context?.host != null) {
    return {
      kind: "unknown",
      detail: `Docker isn't answering, and keyloom doesn't know what starts the engine behind your context "${context.name}" (${context.host}). Start it yourself, then build again.`,
    };
  }
  return { kind: "none" };
}

export type StartDockerOptions = {
  /** The one deadline for the whole start: the launch command and the wait after it share it. A cold Docker Desktop takes 15-40 s. */
  timeoutMs?: number;
  /** How often to ask the daemon again while it starts. */
  pollMs?: number;
  /** Runs the start command within `budgetMs`, what is left of the deadline, and stops it on `signal`; the real one does. A test passes a fake. */
  start?: (engine: DockerEngine, budgetMs: number, signal?: AbortSignal) => Promise<{ ok: boolean; detail?: string }>;
  /** Asks the daemon; the real one does. */
  status?: () => Promise<DockerStatus>;
  /** Finds the engine; the real one does. */
  detect?: () => Promise<EngineFinding>;
  /** Says what is happening, for a build log or a progress line. */
  onProgress?: (line: string) => void;
  /** Stops waiting (an aborted build). */
  signal?: AbortSignal;
  /** Injected waiting, so a test does not sleep. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const DEFAULT_START_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 1_500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Gets the daemon up: returns at once when it already is, otherwise starts the engine it finds and waits
 * for it. Never hangs longer than `timeoutMs`, and never leaves the person without the reason.
 */
const MIN_LAUNCH_MS = 5_000;

export async function startDockerEngine(opts: StartDockerOptions = {}): Promise<DockerStartResult> {
  const status = opts.status ?? (() => dockerStatus(5_000));
  const detect = opts.detect ?? (() => findDockerEngine());
  const start = opts.start ?? runStart;
  const sleep = opts.sleep ?? wait;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  let first = await status();
  // A daemon that only answered slowly is there and may be busy. Starting it would restart a running Colima VM and stop whatever it was
  // running, so keyloom asks again until it answers or says it is down; only a daemon that is down is started (D-497).
  while (!first.ok && first.kind === "slow" && Date.now() < deadline) {
    if (opts.signal?.aborted) return { ok: false, engine: null, reason: "Stopped waiting for Docker." };
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())), opts.signal);
    first = await status();
  }
  if (first.ok) return { ok: true, version: first.version, engine: "the Docker daemon", waitedMs: Date.now() - startedAt };
  if (first.kind === "slow") {
    return { ok: false, engine: null, reason: `Docker didn't answer within ${Math.round(timeoutMs / 1000)} s. It may be busy, so keyloom didn't restart it. Check again in a minute.` };
  }
  // No engine at all, one whose CLI never reached the PATH, or one that refuses this account: an install, a link or a permission, not a start.
  if (first.kind === "not-installed" || first.kind === "cli-missing" || first.kind === "no-access") return { ok: false, engine: null, reason: first.reason };

  const found = await detect();
  if (found.kind !== "engine") {
    // `elsewhere` and `unknown` name what would fix it; `none` falls back to the daemon's own sentence.
    return { ok: false, engine: null, reason: found.kind === "none" ? first.reason : found.detail };
  }
  const engine = found.engine;
  const action = engine.command.includes("restart") ? "restarting" : engine.command.some((part) => part === "start" || part === "-a") ? "starting" : "waking";
  opts.onProgress?.(`keyloom: Docker isn't answering, so ${action} ${engine.name} (a cold start can take half a minute)`);
  // With only seconds left, a launch would be killed at once and could leave the engine half started.
  if (deadline - Date.now() < Math.min(MIN_LAUNCH_MS, timeoutMs / 4)) return { ok: false, engine: engine.name, reason: `Docker didn't answer in time, so keyloom didn't start ${engine.name}. Check again in a minute.` };
  const launched = await start(engine, deadline - Date.now(), opts.signal);
  if (opts.signal?.aborted) return { ok: false, engine: engine.name, reason: `Stopped starting ${engine.name}.` };
  if (!launched.ok) {
    return { ok: false, engine: engine.name, reason: `keyloom couldn't start ${engine.name}${launched.detail ? `: ${launched.detail}` : ""}${engine.hint ? `. ${engine.hint}` : ""}` };
  }

  // Asked at least once after the launch, even when the launch used the whole window: `colima start` returns once Docker is up.
  for (;;) {
    if (opts.signal?.aborted) return { ok: false, engine: engine.name, reason: `Stopped waiting for ${engine.name}.` };
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())), opts.signal);
    const next = await status();
    if (next.ok) {
      const waitedMs = Date.now() - startedAt;
      opts.onProgress?.(`keyloom: ${engine.name} is up after ${Math.round(waitedMs / 1000)} s`);
      return { ok: true, version: next.version, engine: engine.name, waitedMs };
    }
    if (next.kind === "not-installed" || next.kind === "cli-missing" || next.kind === "no-access") return { ok: false, engine: engine.name, reason: next.reason };
    if (Date.now() >= deadline) break;
  }
  return { ok: false, engine: engine.name, reason: `${engine.name} did not answer within ${Math.round(timeoutMs / 1000)} s. Open it, wait for it to say it is running, then build again.` };
}

/**
 * Runs an engine's start command and waits for it, up to what is left of the start's deadline; `open -a` returns once the app has launched.
 * A cancelled build stops it too, and a launch stopped that way failed, whatever it exited with.
 */
export async function runStart(engine: DockerEngine, budgetMs: number, signal?: AbortSignal): Promise<{ ok: boolean; detail?: string }> {
  const [command, ...args] = engine.command;
  if (command === undefined || which(command) === null) return { ok: false, detail: `${engine.command[0]} is not on PATH` };
  const r = await capture([command, ...args], { timeoutMs: budgetMs, ...(signal === undefined ? {} : { signal }) });
  if (r.aborted) return { ok: false, detail: "it was stopped" };
  if (r.exitCode === 0) return { ok: true };
  const said = (r.stderr || r.stdout).trim().split("\n").at(-1);
  return { ok: false, detail: said || (r.timedOut ? "it did not start in time" : `it exited with code ${r.exitCode}`) };
}
