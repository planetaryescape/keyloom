// Firmware is built in Docker, so "is the daemon up" is part of keyloom working rather than a prerequisite
// the person has to keep in mind. This asks, and starts the engine it finds when it isn't (D-486, D-487).
import {
  DOCKER_GROUP_COMMAND, type DockerEngine, type DockerInstall, type DockerProblem, type DockerStartResult, type DockerStatus, type EngineFinding,
  dockerInstall, dockerStatus, findDockerEngine, reasonWithHint, restartColima, restartDockerApp, startDockerEngine,
} from "../firmware/toolchain/docker.ts";

// The CLI asks the daemon before it installs (it may not import the toolchain itself).
export { type DockerStatus, dockerStatus, reasonWithHint };

/** What the UI and `doctor` show: whether a build can run now, and what would fix it if not. */
export type DockerReadiness =
  | { ok: true; version: string; engine: string; autoStart: boolean }
  | {
      ok: false; problem: DockerProblem; reason: string;
      /** The engine keyloom would start, or null when it found none it knows how to start. */
      engine: string | null;
      /** Whether a start from keyloom could help, given the engine it found and the person's setting. */
      canStart: boolean;
      autoStart: boolean;
      /** What to install, when there is no Docker at all; null otherwise. */
      install: DockerInstall | null;
      /** How to get this account access, when the daemon refuses it (`no-access`); null otherwise. */
      access: DockerAccessFix | null;
      /** The engine keyloom can stop and start from scratch when a start fails (Colima, R3-04); null otherwise. */
      restartEngine: string | null;
    };

/**
 * The way out of `no-access`: a command to paste where the fix needs sudo (keyloom can't answer its password prompt), otherwise a
 * sentence. Linux joins the docker group and needs a new login. Colima creates its socket readable by its owner only, so a socket
 * this account can't open belongs to another one, usually root after `sudo colima start`: that copy is stopped, the files given back
 * and Colima started as the person. The Mac apps run as the person, so reopening one gives the socket back, and `restartApp` names
 * the app keyloom can restart itself (R2-07).
 */
export type DockerAccessFix = { command: string | null; note: string; restartApp: string | null };

export function dockerAccessFix(platform: NodeJS.Platform, engine: DockerEngine | null): DockerAccessFix {
  if (platform === "linux") {
    return {
      command: DOCKER_GROUP_COMMAND, restartApp: null,
      note: "It adds your account to the docker group, which Docker warns grants root-level access to this computer. Log out and back in so the change takes effect, then open keyloom again.",
    };
  }
  if (engine?.command[0] === "colima") {
    const at = engine.command.indexOf("--profile");
    const profile = at < 0 ? "" : ` ${engine.command.slice(at, at + 2).join(" ")}`;
    return {
      // `env HOME` so sudo stops the copy that runs from this account's ~/.colima, whatever sudo does with HOME.
      command: `sudo env HOME="$HOME" colima stop${profile}; sudo chown -R "$USER" ~/.colima && colima start${profile}`, restartApp: null,
      note: "Colima's files belong to another account, usually because Colima was started with sudo. This stops that copy, gives the files back to you and starts Colima as you. Then check again.",
    };
  }
  const app = platform === "darwin" && engine?.command[0] === "open" ? engine.name : null;
  return { command: null, restartApp: app, note: `Quit ${engine?.name ?? "your Docker app"} and open it again, then check again.` };
}

/** The parts a test replaces, so no test launches an app or talks to a daemon. */
export type ToolchainOverrides = {
  status?: () => Promise<DockerStatus>;
  detect?: () => Promise<EngineFinding>;
  startEngine?: (opts: Parameters<typeof startDockerEngine>[0]) => Promise<DockerStartResult>;
  /** Quits and reopens a Mac engine app; the real one runs osascript and `open -a`. */
  restartApp?: typeof restartDockerApp;
  /** Stops Colima hard and starts it again; the real one runs `colima stop --force` and `colima start`. */
  restartColima?: typeof restartColima;
  /** The process's environment, for the opt-out below. */
  env?: Record<string, string | undefined>;
  /** What "this computer" is, for the install advice. */
  platform?: NodeJS.Platform;
  /** Which commands are here, such as Homebrew; injected so the install advice doesn't depend on the test machine. */
  has?: (command: string) => boolean;
};

/**
 * Whether keyloom may start the engine without asking. It may, by default: starting an app the person
 * already installed on their own machine is not a privileged act, and a build that stops at a closed
 * Docker Desktop is a dead end. `KEYLOOM_DOCKER_AUTOSTART=0` (or `false`, `no`, `off`) turns it off.
 */
export function dockerAutoStart(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.KEYLOOM_DOCKER_AUTOSTART?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "no" || value === "off");
}

/** The daemon's state, and what would fix it. Cheap enough to ask before a build. */
export async function dockerReadiness(over: ToolchainOverrides = {}): Promise<DockerReadiness> {
  const status = over.status ?? (() => dockerStatus());
  const autoStart = dockerAutoStart(over.env ?? process.env);
  const now = await status();
  if (now.ok) return { ok: true, version: now.version, engine: "Docker", autoStart };

  // An install or a missing link needs no engine hunt: there is nothing here to start. A missing link names its app, which a click opens.
  const finding = now.kind === "not-installed" || now.kind === "cli-missing" ? null : await (over.detect ?? findDockerEngine)();
  const found = finding?.kind === "engine" ? finding.engine : null;
  const engine = now.kind === "cli-missing" ? now.app ?? null : found?.name ?? null;
  const reason = finding !== null && (finding.kind === "elsewhere" || finding.kind === "unknown") ? finding.detail : now.reason;
  const platform = over.platform ?? process.platform;
  return {
    ok: false, problem: now.kind, reason, engine,
    // A start can't give this account the socket, so it isn't offered for `no-access`; a build doesn't open an app for its CLI.
    canStart: autoStart && engine !== null && now.kind !== "no-access" && now.kind !== "cli-missing",
    autoStart,
    install: now.kind === "not-installed" ? dockerInstall(platform, ...(over.has === undefined ? [] : [over.has])) : null,
    access: now.kind === "no-access" ? dockerAccessFix(platform, found) : null,
    // Only a dead daemon: a slow one is up and may be running a build that a restart would kill (D-497).
    restartEngine: now.kind === "daemon-down" && found?.command[0] === "colima" ? found.name : null,
  };
}

/**
 * One engine action at a time in this process: a page's Start, a page's Restart, and a build's own start. A restart runs `colima stop
 * --force`, which would kill a start in progress, so a restart is refused while anything holds this; a start waits its turn, then finds
 * Docker up and returns at once.
 */
let engineHolder: { kind: "start" | "restart"; done: Promise<void> } | null = null;

class EngineWaitAborted extends Error {}

async function holdEngine<T>(kind: "start" | "restart", fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  // Each waiter checks again when it wakes: the first to run takes it before the others resume.
  while (engineHolder !== null) {
    if (signal?.aborted) throw new EngineWaitAborted();
    const held = engineHolder.done;
    await new Promise<void>((resolve) => {
      const stop = () => resolve();
      signal?.addEventListener("abort", stop, { once: true });
      void held.then(() => {
        signal?.removeEventListener("abort", stop);
        resolve();
      });
    });
  }
  if (signal?.aborted) throw new EngineWaitAborted();
  let release!: () => void;
  engineHolder = { kind, done: new Promise<void>((resolve) => (release = resolve)) };
  try {
    return await fn();
  } finally {
    engineHolder = null;
    release();
  }
}

/** Starts the engine and waits for it, whatever the person's setting says: what an explicit click or flag asks for. */
export async function startDocker(opts: { onProgress?: (line: string) => void; signal?: AbortSignal; overrides?: ToolchainOverrides } = {}): Promise<DockerStartResult> {
  try {
    return await holdEngine("start", () => startDockerUnheld(opts), opts.signal);
  } catch (err) {
    if (err instanceof EngineWaitAborted) return { ok: false, engine: null, reason: "Stopped waiting for Docker." };
    throw err;
  }
}

function startDockerUnheld(opts: { onProgress?: (line: string) => void; signal?: AbortSignal; overrides?: ToolchainOverrides }): Promise<DockerStartResult> {
  const over = opts.overrides ?? {};
  const start = over.startEngine ?? startDockerEngine;
  return start({
    ...(over.status === undefined ? {} : { status: over.status }),
    ...(over.detect === undefined ? {} : { detect: over.detect }),
    ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
}

/**
 * Restarts what runs Docker, for the two cases a start can't fix: the Mac app that refuses this account its socket (`no-access`,
 * R2-07), and a Colima whose daemon is down (R3-04), which is stopped hard and started again. Anything else keeps its own fix, so this
 * says so instead of guessing. A Docker that answers, even slowly, is left running.
 */
export async function restartDocker(opts: { onProgress?: (line: string) => void; signal?: AbortSignal; overrides?: ToolchainOverrides } = {}): Promise<DockerStartResult> {
  // Refused, not queued: by the time a start ends Docker is usually up, and a restart then would stop it for nothing.
  if (engineHolder !== null) {
    const what = engineHolder.kind === "restart" ? "restarting" : "starting";
    return { ok: false, engine: null, reason: `keyloom is already ${what} Docker, for this page or for a build. Wait for that to finish, then check again.` };
  }
  return holdEngine("restart", () => restartDockerUnheld(opts));
}

async function restartDockerUnheld(opts: { onProgress?: (line: string) => void; signal?: AbortSignal; overrides?: ToolchainOverrides }): Promise<DockerStartResult> {
  const over = opts.overrides ?? {};
  // Quitting a Docker that works would stop whatever it runs, such as a build for an auto-sync, so only a refusal or a dead engine is restarted.
  const now = await (over.status ?? (() => dockerStatus()))();
  if (now.ok) return { ok: true, version: now.version, engine: "Docker", waitedMs: 0 };
  // A slow daemon is up and may be busy: `colima stop --force` would kill the build it runs, such as an auto-sync's (D-497).
  if (now.kind === "slow") return { ok: false, engine: null, reason: "Docker is answering slowly, so it may be running a build. keyloom didn't restart it, because that would stop the build. Check again in a minute." };
  if (now.kind === "daemon-down") {
    const finding = await (over.detect ?? findDockerEngine)();
    if (finding.kind === "engine" && finding.engine.command[0] === "colima") {
      return (over.restartColima ?? restartColima)(finding.engine, {
        ...(over.status === undefined ? {} : { status: over.status }),
        ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
    }
  }
  if (now.kind !== "no-access") {
    return { ok: false, engine: null, reason: `keyloom restarts Colima when it won't start, or a Docker app when it refuses this account, and this isn't either: ${now.reason}` };
  }
  const finding = await (over.detect ?? findDockerEngine)();
  const engine = finding.kind === "engine" ? finding.engine : null;
  // restartDockerApp itself refuses an engine that isn't an app.
  if (engine === null || (over.platform ?? process.platform) !== "darwin") {
    return { ok: false, engine: engine?.name ?? null, reason: "keyloom can only restart a Docker app on a Mac, and it didn't find one here. Restart your Docker engine yourself, then check again." };
  }
  return (over.restartApp ?? restartDockerApp)(engine, {
    ...(over.status === undefined ? {} : { status: over.status }),
    ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
}

export type EnsureDockerResult =
  | { ok: true; started: boolean; engine: string }
  | { ok: false; reason: string; engine: string | null };

/**
 * Gets the daemon ready for a build: nothing to do when it is up, otherwise start the engine and wait.
 * The reason it failed is a sentence the person can act on, so a caller never has to explain Docker.
 */
export async function ensureDocker(opts: { onProgress?: (line: string) => void; signal?: AbortSignal; overrides?: ToolchainOverrides } = {}): Promise<EnsureDockerResult> {
  const over = opts.overrides ?? {};
  const status = over.status ?? (() => dockerStatus());
  const now = await status();
  if (now.ok) return { ok: true, started: false, engine: "Docker" };
  // Nothing to start when there is no engine, its CLI never reached the PATH, or it refuses this account: an install, a link or a permission.
  if (now.kind === "not-installed" || now.kind === "cli-missing" || now.kind === "no-access") return { ok: false, engine: null, reason: now.reason };

  const detect = over.detect ?? findDockerEngine;
  if (!dockerAutoStart(over.env ?? process.env)) {
    const finding = await detect();
    const reason = finding.kind === "elsewhere" || finding.kind === "unknown"
      ? `${finding.detail} Starting Docker automatically is off (KEYLOOM_DOCKER_AUTOSTART=0).`
      : `${now.reason.replace(/\.$/, "")}, and keyloom is set not to start it (KEYLOOM_DOCKER_AUTOSTART=0). Start it, then build again.`;
    return { ok: false, engine: null, reason };
  }

  const start = over.startEngine ?? startDockerEngine;
  let result: DockerStartResult;
  try {
    result = await holdEngine("start", () => start({
      status,
      detect,
      ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    }), opts.signal);
  } catch (err) {
    if (err instanceof EngineWaitAborted) return { ok: false, engine: null, reason: "Stopped waiting for Docker." };
    throw err;
  }
  // The build log is read like a terminal, so a failure keeps the engine's hint.
  return result.ok ? { ok: true, started: true, engine: result.engine } : { ok: false, reason: reasonWithHint(result), engine: result.engine };
}
