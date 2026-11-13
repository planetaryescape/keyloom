// Firmware is built in Docker, so "is the daemon up" is part of keyloom working rather than a prerequisite
// the person has to keep in mind. This asks, and starts the engine it finds when it isn't (D-486, D-487).
import {
  COLIMA_STOP_MS, type ColimaStop, DOCKER_GROUP_COMMAND, type DockerEngine, type DockerInstall, type DockerProblem, type DockerStartResult, type DockerStatus, type EngineFinding,
  dockerInstall, dockerStatus, findDockerEngine, reasonWithHint, restartColima, restartDockerApp, runStart, startDockerEngine,
} from "../firmware/toolchain/docker.ts";
import { adminRunner, colimaFilesPlan, colimaLinkedFileSeen, realPlanDeps, runColimaRootSteps } from "./colima-files.ts";
import type { Runner } from "./remapper-setup.ts";

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
      /** Other engines to install, for a `restartEngine` that won't start even after a restart (R4-04b); empty otherwise. */
      alternatives: Array<{ name: string; url: string }>;
      /**
       * keyloom is starting or restarting the engine, or fixing Colima's files, now, for a page or a build, so the page shows that instead
       * of a button (R4-04, D-533).
       */
      engineAction: EngineAction | null;
    };

/**
 * The way out of `no-access`: a command to paste where the fix needs sudo (keyloom can't answer its password prompt), otherwise a
 * sentence. Linux joins the docker group and needs a new login. Colima creates its socket readable by its owner only, so a socket
 * this account can't open belongs to another one, usually root after `sudo colima start`: that copy is stopped, the files given back
 * and Colima started as the person; on a Mac `fixFiles` says keyloom can do that itself (D-533). The Mac apps run as the person, so reopening one gives the socket back, and `restartApp` names
 * the app keyloom can restart itself (R2-07).
 */
export type DockerAccessFix = {
  command: string | null; note: string; restartApp: string | null;
  /** keyloom can run Colima's command itself, through macOS's password dialog (D-533): a Colima on a Mac. */
  fixFiles: boolean;
  /** A file in ~/.colima has a second name, so `command`, whose `chown -R` would change it, is held back (null). Readiness only. */
  linkedFile?: boolean;
};

export function dockerAccessFix(platform: NodeJS.Platform, engine: DockerEngine | null): DockerAccessFix {
  if (platform === "linux") {
    return {
      command: DOCKER_GROUP_COMMAND, restartApp: null, fixFiles: false,
      note: "It adds your account to the docker group, which Docker warns grants root-level access to this computer. Log out and back in so the change takes effect, then open keyloom again.",
    };
  }
  if (engine?.command[0] === "colima") {
    const at = engine.command.indexOf("--profile");
    const profile = at < 0 ? "" : ` ${engine.command.slice(at, at + 2).join(" ")}`;
    return {
      // `env HOME` so sudo stops the copy that runs from this account's ~/.colima, whatever sudo does with HOME.
      command: `sudo env HOME="$HOME" colima stop${profile}; sudo chown -R "$USER" ~/.colima && colima start${profile}`, restartApp: null,
      fixFiles: platform === "darwin",
      note: "Colima's files belong to another account, usually because Colima was started with sudo. This stops that copy, gives the files back to you and starts Colima as you. Then check again.",
    };
  }
  const app = platform === "darwin" && engine?.command[0] === "open" ? engine.name : null;
  return { command: null, restartApp: app, fixFiles: false, note: `Quit ${engine?.name ?? "your Docker app"} and open it again, then check again.` };
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
  /** Runs the osascript call for Fix Colima's files; the real one shows macOS's password dialog. */
  adminRun?: Runner;
  /** Stops Colima as the person after Fix Colima's files; the real one runs `colima stop`. */
  colimaStop?: ColimaStop;
  /** The checked paths and IDs for Fix Colima's files; the real one reads this computer. */
  colimaPlan?: (engine: DockerEngine) => ReturnType<typeof colimaFilesPlan>;
  /** Looks in ~/.colima, as the person, for a file with a second name; the real one runs `find`. */
  colimaLinkedScan?: typeof colimaLinkedFileSeen;
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
  const colima = now.kind === "daemon-down" && found?.command[0] === "colima";
  return {
    ok: false, problem: now.kind, reason, engine,
    // A start can't give this account the socket, so it isn't offered for `no-access`; a build doesn't open an app for its CLI.
    canStart: autoStart && engine !== null && now.kind !== "no-access" && now.kind !== "cli-missing",
    autoStart,
    install: now.kind === "not-installed" ? dockerInstall(platform, ...(over.has === undefined ? [] : [over.has])) : null,
    access: now.kind === "no-access" ? await accessFix(platform, found, over) : null,
    // Only a dead daemon: a slow one is up and may be running a build that a restart would kill (D-497).
    restartEngine: colima ? found.name : null,
    alternatives: colima ? otherEngines(platform, found.name, over.has) : [],
    engineAction: engineHolder?.kind ?? null,
  };
}

/**
 * The way to get access, with Colima's command held back while a linked file is known: one Fix Colima's files found since the last fix
 * that completed, or one the person's own look finds now. Kept here, not only in the page, so a reload or another page can't show the
 * `chown -R` again (PR #300 CodeRabbit).
 */
async function accessFix(platform: NodeJS.Platform, engine: DockerEngine | null, over: ToolchainOverrides): Promise<DockerAccessFix> {
  const fix = dockerAccessFix(platform, engine);
  if (!fix.fixFiles || engine === null) return fix;
  const linked = colimaLinkedFileFound || await (over.colimaLinkedScan ?? colimaLinkedFileSeen)(engine);
  return linked ? { ...fix, command: null, linkedFile: true } : fix;
}

/**
 * Why Colima's command is held back, said in place of its note. The page says the same (`release-words.ts`, which can't import this
 * folder); a test keeps the two equal.
 */
export const COLIMA_LINKED_FILE_HELD = "A file in Colima's folder also has a name somewhere else, so keyloom doesn't offer Colima's command, which would change that file's owner too. Check what the file is. Fix Colima's files looks for it again and changes nothing while it is there.";

/** Fix Colima's files stopped at a linked file, and no fix has completed since. Reset when this process starts; the look covers that. */
let colimaLinkedFileFound = false;

/** The engines to install instead of one that won't start: this platform's install and its alternatives, without the one that failed. */
function otherEngines(platform: NodeJS.Platform, failed: string, has?: (command: string) => boolean): Array<{ name: string; url: string }> {
  const install = dockerInstall(platform, ...(has === undefined ? [] : [has]));
  return [{ name: install.engine, url: install.url }, ...install.alternatives].filter((engine) => engine.name !== failed);
}

/**
 * One engine action at a time in this process: a page's Start, a page's Restart, and a build's own start. A restart runs `colima stop
 * --force`, which would kill a start in progress, so a restart is refused while anything holds this; a start waits its turn, then finds
 * Docker up and returns at once.
 */
let engineHolder: { kind: EngineAction; done: Promise<void> } | null = null;

/** What holds the engine: a start, a restart, or Fix Colima's files, whose password dialog can stay open for minutes (D-533). */
type EngineAction = "start" | "restart" | "fix-files";

/** The refusal for an action that would fight the one holding the engine; null when nothing holds it. */
function engineBusy(): { ok: false; engine: null; code: "engine_busy"; reason: string } | null {
  if (engineHolder === null) return null;
  const what = engineHolder.kind === "fix-files" ? "fixing Colima's files" : engineHolder.kind === "restart" ? "restarting Docker" : "starting Docker";
  return { ok: false, engine: null, code: "engine_busy", reason: `keyloom is already ${what}, for this page or for a build. Wait for that to finish, then check again.` };
}

/** What holds the engine lock in this process now: a start, a restart or a Colima files fix, or null (R4-04, R7-04, D-533). */
export const engineActionNow = (): EngineAction | null => engineHolder?.kind ?? null;

class EngineWaitAborted extends Error {}

// Waits until nothing (or, with `only`, no action of those kinds) holds the engine. Each waiter checks again when it wakes.
async function waitForEngine(signal: AbortSignal | undefined, only?: readonly EngineAction[]): Promise<void> {
  while (engineHolder !== null && (only === undefined || only.includes(engineHolder.kind))) {
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
}

async function holdEngine<T>(kind: EngineAction, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  // Checked again after every wait, in the same synchronous run as the take below, so the first waiter to wake takes it and a free lock
  // is taken without yielding.
  while (engineHolder !== null) await waitForEngine(signal);
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
export async function restartDocker(opts: RestartOptions = {}): Promise<DockerStartResult & { code?: "engine_busy" | "build_running" }> {
  // Refused, not queued: by the time a start ends Docker is usually up, and a restart then would stop it for nothing. The code lets the
  // page follow the action that is running instead of offering the restart again (R4-04).
  return engineBusy() ?? holdEngine("restart", () => restartDockerUnheld(opts));
}

type RestartOptions = {
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
  overrides?: ToolchainOverrides;
  /**
   * Restart an engine that answers, for a build that failed on the engine's own state: a stale shared folder or a container it can't
   * remove (R6-09, R6-17). It stops every container, so it needs `blocker`.
   */
  force?: boolean;
  /**
   * Why a forced restart can't stop the engine now (a build, flash or container run would stop), or null; serve passes
   * `engineRestartBlocker`. It is asked inside the engine lock, right before the stop, and `ensureDocker` waits while a restart holds
   * that lock, so no build can start between the check and the stop. A forced restart without one is refused.
   */
  blocker?: () => string | null;
};

/** The engine a forced restart would restart: Colima, or a Mac engine app. Null for any other, such as Linux's system service (R6-09). */
export async function forcedRestartEngine(over: ToolchainOverrides = {}): Promise<DockerEngine | null> {
  const finding = await (over.detect ?? findDockerEngine)();
  if (finding.kind !== "engine") return null;
  const { engine } = finding;
  if (engine.command[0] === "colima") return engine;
  return engine.command[0] === "open" && (over.platform ?? process.platform) === "darwin" ? engine : null;
}

export const FORCED_RESTART_UNGUARDED = "keyloom can't tell whether a build is running here, so it didn't restart Docker.";

async function restartDockerUnheld(opts: RestartOptions): Promise<DockerStartResult & { code?: "build_running" }> {
  const over = opts.overrides ?? {};
  // Quitting a Docker that works would stop whatever it runs, such as a build for an auto-sync, so only a refusal or a dead engine is
  // restarted, unless the caller forces it for a build that failed on the engine itself.
  const now = await (over.status ?? (() => dockerStatus()))();
  if (opts.force === true && (now.ok || now.kind === "slow")) return forcedRestart(opts);
  if (now.ok) return { ok: true, version: now.version, engine: "Docker", waitedMs: 0 };
  // A slow daemon is up and may be busy: `colima stop --force` would kill the build it runs, such as an auto-sync's (D-497).
  if (now.kind === "slow") return { ok: false, engine: null, reason: "Docker is answering slowly, so it may be running a build. keyloom didn't restart it, because that would stop the build. Check again in a minute." };
  if (now.kind === "daemon-down") {
    const finding = await (over.detect ?? findDockerEngine)();
    if (finding.kind === "engine" && finding.engine.command[0] === "colima") {
      const blocked = forcedBlock(opts);
      if (blocked !== null) return blocked;
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
  const blocked = forcedBlock(opts);
  if (blocked !== null) return blocked;
  return (over.restartApp ?? restartDockerApp)(engine, {
    ...(over.status === undefined ? {} : { status: over.status }),
    ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
}

/**
 * A forced request's refusal, asked inside the engine lock right before a stop, or null to go on. A forced request asks it whatever
 * Docker's status read, because the status is read once, before the engine is found, and every stop ends the work the blocker
 * protects. A plain restart of a dead or refusing engine goes on without it, as before (PR #297 CodeRabbit).
 */
function forcedBlock(opts: RestartOptions): (DockerStartResult & { code: "build_running" }) | null {
  if (opts.force !== true) return null;
  const blocked = opts.blocker === undefined ? FORCED_RESTART_UNGUARDED : opts.blocker();
  return blocked === null ? null : { ok: false, engine: null, reason: blocked, code: "build_running" };
}

async function forcedRestart(opts: RestartOptions): Promise<DockerStartResult & { code?: "build_running" }> {
  const over = opts.overrides ?? {};
  const engine = await forcedRestartEngine(over);
  if (engine === null) return { ok: false, engine: null, reason: "keyloom restarts Colima or a Docker app, and your Docker engine is neither. Restart it yourself, then build again." };
  const blocked = forcedBlock(opts);
  if (blocked !== null) return blocked;
  const wait = {
    ...(over.status === undefined ? {} : { status: over.status }),
    ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  };
  return engine.command[0] === "colima" ? (over.restartColima ?? restartColima)(engine, wait) : (over.restartApp ?? restartDockerApp)(engine, wait);
}

/**
 * Fix Colima's files (D-533), for a Colima that refuses this account because its files belong to another one. macOS asks for the
 * administrator password, root gives the files back (`runColimaRootSteps`), then Colima stops and starts as the person and keyloom
 * waits for Docker. Refused while keyloom starts or restarts Docker. The stop ends whatever the other copy runs, so `blocker` is
 * asked inside the engine lock, right before the password dialog, and the fix is refused without one, as a forced restart is (D-529).
 */
export async function fixColimaFiles(opts: RestartOptions = {}): Promise<DockerStartResult & { code?: "engine_busy" | ColimaFixCode }> {
  return engineBusy() ?? holdEngine("fix-files", () => fixColimaFilesUnheld(opts));
}

export const COLIMA_FIX_UNGUARDED = "keyloom can't tell whether a build is running here, so it didn't change Colima.";

/** The codes the page acts on. `vm_running`: another account's Colima VM runs from ~/.colima, found before the dialog or by root. */
type ColimaFixCode = "build_running" | "cancelled" | "linked_file" | "vm_running";

async function fixColimaFilesUnheld(opts: RestartOptions): Promise<DockerStartResult & { code?: ColimaFixCode }> {
  const over = opts.overrides ?? {};
  const now = await (over.status ?? (() => dockerStatus()))();
  if (now.ok) return { ok: true, version: now.version, engine: "Docker", waitedMs: 0 };
  // Asked again, because the password dialog is for this one problem and the page may be showing an old answer.
  if (now.kind !== "no-access") return { ok: false, engine: null, reason: "Docker doesn't refuse keyloom any more, so keyloom changed nothing. Check again to see what Docker needs now." };
  if ((over.platform ?? process.platform) !== "darwin") return { ok: false, engine: null, reason: "keyloom fixes Colima's files on a Mac only. Run Colima's command in a terminal yourself, then check again." };
  const finding = await (over.detect ?? findDockerEngine)();
  if (finding.kind !== "engine" || finding.engine.command[0] !== "colima") {
    return { ok: false, engine: null, reason: "Docker here isn't run by Colima any more, so keyloom changed nothing. Check again to see what Docker needs now." };
  }
  const engine = finding.engine;
  const planned = (over.colimaPlan ?? ((e: DockerEngine) => colimaFilesPlan(e, realPlanDeps())))(engine);
  if (!planned.ok) return { ok: false, engine: engine.name, reason: planned.reason, ...(planned.code === "colima_vm_running" ? { code: "vm_running" as const } : {}) };
  const blocked = opts.blocker === undefined ? COLIMA_FIX_UNGUARDED : opts.blocker();
  if (blocked !== null) return { ok: false, engine: null, reason: blocked, code: "build_running" };
  opts.onProgress?.("keyloom: asking macOS for an administrator password to fix Colima's files");
  const root = await runColimaRootSteps(planned.plan, over.adminRun ?? adminRunner);
  if (!root.ok) {
    if (root.code === "colima_linked_file") colimaLinkedFileFound = true;
    const code = root.code === "cancelled" ? "cancelled" as const : root.code === "colima_linked_file" ? "linked_file" as const : root.code === "colima_vm_running" ? "vm_running" as const : null;
    return { ok: false, engine: engine.name, reason: root.reason, ...(code === null ? {} : { code }) };
  }
  colimaLinkedFileFound = false;
  // The files are the person's now, so Colima stops and starts as them: a copy of the person's that is still up keeps the socket root
  // made, and a start of a running Colima does nothing. The stop runs after the dialog, so a closed dialog changes nothing, and as the
  // person, never as root (#300 review). It usually has nothing to stop; a stop that fails is said and the start still runs.
  const profile = planned.plan.profile === null ? [] : ["--profile", planned.plan.profile];
  const stopped = await (over.colimaStop ?? colimaStopAsPerson)(["colima", "stop", ...profile], COLIMA_STOP_MS, opts.signal);
  if (!stopped.ok) opts.onProgress?.(`keyloom: Colima didn't stop cleanly${stopped.detail ? ` (${stopped.detail})` : ""}; starting it anyway`);
  // `relaunch` keeps waiting while the socket still refuses as Colima comes up.
  const fresh: DockerEngine = { ...engine, command: ["colima", "start", ...profile] };
  const started = await (over.startEngine ?? startDockerEngine)({
    relaunch: true,
    detect: async () => ({ kind: "engine", engine: fresh }),
    ...(over.status === undefined ? {} : { status: over.status }),
    ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
  return started.ok ? started : { ...started, reason: `Colima's files are yours again, but Colima didn't come up. ${started.reason.replace(/\.?$/, ".")}` };
}

/** `colima stop` as the person. Refused under `bun test`, so a forgotten fake fails its test instead of stopping the machine's Colima. */
const colimaStopAsPerson: ColimaStop = async (command, budgetMs, signal) => {
  if (process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS === "1") throw new Error("refusing to stop Colima in a test");
  return runStart({ name: "Colima", command }, budgetMs, signal);
};

// Container runs other than builds that a forced restart would stop: a lab analysis, a board review's tests, `keyloom emulate`. Builds
// are found from their own rows; these have none, so each run says what it is for as long as it may run a container (D-529).
const containerWork = new Map<symbol, string>();

/** Marks a container run as under way, named for the person ("a lab analysis"), until the returned function is called. */
export function holdContainerWork(what: string): () => void {
  const key = Symbol(what);
  containerWork.set(key, what);
  return () => void containerWork.delete(key);
}

/** What holds a container run in this process now, each name once. */
export const containerWorkRunning = (): string[] => [...new Set(containerWork.values())];

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
  // A forced restart stops every container, even on a Docker that answers, and Fix Colima's files stops Colima. A build or replay that
  // gets here while one runs waits for it, so it never starts a container between the last check for running work and the stop (D-529,
  // D-533).
  // The wait can take minutes, so the build log says why it has stopped moving.
  if (engineHolder?.kind === "restart") opts.onProgress?.("keyloom: waiting for keyloom to finish restarting Docker");
  if (engineHolder?.kind === "fix-files") opts.onProgress?.("keyloom: waiting for keyloom to finish fixing Colima's files");
  try {
    await waitForEngine(opts.signal, ["restart", "fix-files"]);
  } catch (err) {
    if (err instanceof EngineWaitAborted) return { ok: false, engine: null, reason: "Stopped waiting for Docker." };
    throw err;
  }
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
