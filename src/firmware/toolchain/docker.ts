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

/** `app` names the engine app whose CLI is missing (`cli-missing` only), so the UI can offer to open it. */
export type DockerStatus = { ok: true; version: string } | { ok: false; kind: DockerProblem; reason: string; app?: string };

const hasCommand = (command: string): boolean => which(command) !== null;

export async function dockerStatus(timeoutMs = 15_000): Promise<DockerStatus> {
  if (!which("docker") && adoptBundledDockerCli() === null) {
    const app = installedEngineApp();
    return app === null
      ? { ok: false, kind: "not-installed", reason: `Docker is not on this computer. ${installSentence()}` }
      : cliMissing(app);
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
// `clis` are where each app puts its `docker`: inside the bundle, then the per-user folder its setup fills when it is told not to
// write to /usr/local/bin (Docker Desktop's "User" CLI setting, ~/.orbstack/bin, Rancher's ~/.rd/bin). The second only exists
// once the app has been opened, which is what the Open button for `cli-missing` is for.
// `bundleId` is what AppleScript quits by, so a renamed app or a second copy can't be confused with it; each is the id its Homebrew cask's
// `uninstall quit:` names (homebrew-cask Casks/{d/docker-desktop,o/orbstack,r/rancher,p/podman-desktop}.rb, checked 2026-11-11).
const ENGINE_APPS: ReadonlyArray<{ name: string; app: string; bundleId: string; contexts: readonly string[]; hosts: RegExp; clis: readonly string[] }> = [
  { name: "Docker Desktop", app: "Docker.app", bundleId: "com.docker.docker", contexts: ["desktop-linux"], hosts: /\/\.docker\/run\/docker\.sock$|^unix:\/\/\/var\/run\/docker\.sock$|Docker\.app/, clis: ["/Applications/Docker.app/Contents/Resources/bin/docker", join(homedir(), ".docker/bin/docker")] },
  { name: "OrbStack", app: "OrbStack.app", bundleId: "dev.kdrag0n.MacVirt", contexts: ["orbstack"], hosts: /\/\.orbstack\//, clis: ["/Applications/OrbStack.app/Contents/MacOS/bin/docker", join(homedir(), ".orbstack/bin/docker")] },
  { name: "Rancher Desktop", app: "Rancher Desktop.app", bundleId: "io.rancherdesktop.app", contexts: ["rancher-desktop"], hosts: /\/\.rd\//, clis: ["/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/bin/docker", join(homedir(), ".rd/bin/docker")] },
  { name: "Podman Desktop", app: "Podman Desktop.app", bundleId: "io.podmandesktop.PodmanDesktop", contexts: ["podman", "podman-desktop"], hosts: /podman\.sock$/, clis: [] },
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
    if (!installed(entry.app)) continue;
    const cli = entry.clis.find((path) => exists(path));
    if (cli !== undefined) return cli;
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

/**
 * An engine app whose CLI keyloom couldn't find, even bundled in the app. Opening an app that brings its own CLI sets it up (R2-07), so
 * the status names it for an Open button. Podman Desktop brings none, so opening it would wait for a command that never comes: its status
 * names no app, and the reason says what is missing.
 */
export function cliMissing(app: { name: string; clis: readonly string[] }): DockerStatus {
  if (app.clis.length === 0) {
    return { ok: false, kind: "cli-missing", reason: `${app.name} is installed, but it doesn't come with a \`docker\` command, and keyloom builds with one. Install Docker's command line tools, then check again.` };
  }
  return { ok: false, kind: "cli-missing", app: app.name, reason: `${app.name} is installed, but its \`docker\` command isn't on keyloom's PATH. Open ${app.name} and let it finish setting up its command line tools, then try again.` };
}

/** The engine app by its name, for its bundle id and CLI paths. */
export const engineApp = (name: string): (typeof ENGINE_APPS)[number] | undefined => ENGINE_APPS.find((entry) => entry.name === name);

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

  // A docker CLI that Homebrew installed beside Colima points at the default socket until Colima's first successful start switches its
  // context, so a first start that failed or was stopped leaves "default" naming nothing. With no app here, Colima is what runs it (R2-02).
  if (platform === "darwin" && (context === null || context.name === "default")) {
    const colima = await colimaEngine(context, { has, ...(over.colimaRunning === undefined ? {} : { running: over.colimaRunning }) });
    if (colima !== null) return { kind: "engine", engine: colima };
  }

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
  /** What "this computer" is; only a Mac opens an app for its CLI. */
  platform?: NodeJS.Platform;
  /**
   * Launch the engine whatever the daemon says first, and keep waiting while it still refuses this account: a restart that just quit
   * the app (R2-07), where the socket can lag behind the app.
   */
  relaunch?: boolean;
};

const platformIsMac = (opts: StartDockerOptions): boolean => (opts.platform ?? process.platform) === "darwin";

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

  if (opts.relaunch) {
    const found = await detect();
    if (found.kind !== "engine") return { ok: false, engine: null, reason: found.kind === "none" ? "keyloom found no Docker engine to open." : found.detail };
    return launchAndWait(found.engine, opts, { status, start, sleep, timeoutMs, pollMs, startedAt, deadline, opening: null });
  }

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
  // An app whose CLI isn't set up yet is opened: its first run puts the CLI where keyloom looks, and it starts the daemon too (R2-07).
  const opening = first.kind === "cli-missing" && first.app !== undefined && platformIsMac(opts) ? first.app : null;
  // No engine at all, or one that refuses this account: an install or a permission, not a start.
  if (opening === null && (first.kind === "not-installed" || first.kind === "cli-missing" || first.kind === "no-access")) return { ok: false, engine: null, reason: first.reason };

  const found: EngineFinding = opening === null ? await detect() : { kind: "engine", engine: { name: opening, command: ["open", "-a", opening] } };
  if (found.kind !== "engine") {
    // `elsewhere` and `unknown` name what would fix it; `none` falls back to the daemon's own sentence.
    return { ok: false, engine: null, reason: found.kind === "none" ? first.reason : found.detail };
  }
  return launchAndWait(found.engine, opts, { status, start, sleep, timeoutMs, pollMs, startedAt, deadline, opening });
}

type Launch = {
  status: () => Promise<DockerStatus>;
  start: NonNullable<StartDockerOptions["start"]>;
  sleep: NonNullable<StartDockerOptions["sleep"]>;
  timeoutMs: number; pollMs: number; startedAt: number; deadline: number;
  /** The app opened for its CLI, which stays `cli-missing` while its setup runs. */
  opening: string | null;
};

/** Runs the engine's start command, then asks the daemon until it answers, something rules it out, or the deadline passes. */
async function launchAndWait(engine: DockerEngine, opts: StartDockerOptions, l: Launch): Promise<DockerStartResult> {
  const { status, start, sleep, timeoutMs, pollMs, startedAt, deadline, opening } = l;
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
    // An app being opened for its CLI stays `cli-missing` until its setup finishes, so that keeps the wait going, as does a relaunched
    // app whose socket still refuses while it comes up.
    const refusing = next.kind === "no-access" && !opts.relaunch;
    if (next.kind === "not-installed" || (next.kind === "cli-missing" && opening === null) || refusing) return { ok: false, engine: engine.name, reason: next.reason };
    if (Date.now() >= deadline) {
      if (next.kind === "no-access") return { ok: false, engine: engine.name, reason: `keyloom restarted ${engine.name}, but Docker still refuses this account its socket, Check again once ${engine.name} has finished starting.` };
      if (next.kind === "cli-missing") return { ok: false, engine: engine.name, reason: `${engine.name} is open, but keyloom still can't find its docker command. Finish ${engine.name}'s setup, including its command line tools, then check again.` };
      break;
    }
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
  return { ok: false, detail: lastLine(r) || (r.timedOut ? "it did not start in time" : `it exited with code ${r.exitCode}`) };
}

/** The last line a command printed, which is where a launcher puts why it failed. */
const lastLine = (r: { stdout: string; stderr: string }): string => (r.stderr || r.stdout).trim().split("\n").at(-1) ?? "";

/** Quitting and asking about a Mac app; the real one is osascript, and a test passes a fake so nothing quits. */
export type AppControl = {
  /** Asks the app to quit; resolves once it has answered. */
  quit: (app: string, signal?: AbortSignal) => Promise<{ ok: boolean; detail?: string }>;
  /** Waits up to `timeoutMs` for the app to stop running; false when it still runs. */
  waitClosed: (app: string, timeoutMs: number, signal?: AbortSignal) => Promise<boolean>;
};

const osascript = async (lines: string[], timeoutMs: number, signal?: AbortSignal) => {
  // The test preload sets this, so a forgotten fake fails its test instead of quitting an app on the machine.
  if (process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS === "1") throw new Error("refusing to run osascript in a test");
  return capture(["osascript", ...lines.flatMap((line) => ["-e", line])], { timeoutMs, ...(signal === undefined ? {} : { signal }) });
};

/**
 * How AppleScript names the app: by bundle id where keyloom knows it, so the quit reaches that app whatever its file is called, and by name
 * otherwise. The names and ids come from ENGINE_APPS; JSON quoting is also a valid AppleScript string literal for them.
 */
export function appleScriptApp(name: string): string {
  const id = engineApp(name)?.bundleId;
  return id === undefined ? `application ${JSON.stringify(name)}` : `application id ${JSON.stringify(id)}`;
}

export const osascriptAppControl: AppControl = {
  quit: async (app, signal) => {
    const r = await osascript([`quit ${appleScriptApp(app)}`], 30_000, signal);
    return r.exitCode === 0 ? { ok: true } : { ok: false, detail: lastLine(r) || `osascript exited with code ${r.exitCode}` };
  },
  // One script that waits in place: `application "X" is running` asks without launching it, so polling stays inside AppleScript.
  waitClosed: async (app, timeoutMs, signal) => {
    const r = await osascript([`repeat while ${appleScriptApp(app)} is running`, "delay 0.5", "end repeat"], timeoutMs, signal);
    return r.exitCode === 0;
  },
};

const QUIT_WAIT_MS = 30_000;

/**
 * Quits a Mac engine app and opens it again, then waits for Docker (R2-07). A Mac app runs as the person, so a fresh start gives this
 * account its socket back, which is the fix for `no-access` there (D-497). Only an engine started with `open -a` is an app.
 */
export async function restartDockerApp(engine: DockerEngine, opts: StartDockerOptions & { control?: AppControl } = {}): Promise<DockerStartResult> {
  if (engine.command[0] !== "open") return { ok: false, engine: engine.name, reason: `${engine.name} isn't an app keyloom can restart. Restart it yourself, then check again.` };
  const control = opts.control ?? osascriptAppControl;
  opts.onProgress?.(`keyloom: quitting ${engine.name} so it starts again with access for this account`);
  let quit: { ok: boolean; detail?: string };
  try {
    quit = await control.quit(engine.name, opts.signal);
  } catch (err) {
    quit = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  if (!quit.ok) return { ok: false, engine: engine.name, reason: `keyloom couldn't quit ${engine.name}${quit.detail ? ` (${quit.detail})` : ""}. Quit it from its menu, open it again, then check again.` };
  const closed = await control.waitClosed(engine.name, QUIT_WAIT_MS, opts.signal).catch(() => false);
  if (opts.signal?.aborted) return { ok: false, engine: engine.name, reason: `Stopped restarting ${engine.name}.` };
  if (!closed) return { ok: false, engine: engine.name, reason: `${engine.name} is still quitting. Wait until it has closed, then restart it again.` };
  // Opened whatever the daemon says now: a socket that still refuses, or answers slowly, while the app shuts down mustn't leave it quit.
  return startDockerEngine({ ...opts, relaunch: true, detect: async () => ({ kind: "engine", engine }) });
}
