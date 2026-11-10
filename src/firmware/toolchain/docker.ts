// Docker checks: is the daemon up, how much room does its VM have (S7: a full Docker Desktop
// disk fails a build late, with "No space left on device"), and what starts it when it isn't.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { capture, which } from "./run.ts";

/** `daemon-down` is the one a start fixes; `not-installed` needs an install and `slow` may still come up. */
export type DockerProblem = "not-installed" | "daemon-down" | "slow";

export type DockerStatus = { ok: true; version: string } | { ok: false; kind: DockerProblem; reason: string };

export async function dockerStatus(timeoutMs = 15_000): Promise<DockerStatus> {
  if (!which("docker")) return { ok: false, kind: "not-installed", reason: "Docker is not on PATH. Install Docker Desktop or OrbStack." };
  const r = await capture(["docker", "version", "--format", "{{.Server.Version}}"], { timeoutMs });
  if (r.timedOut) return { ok: false, kind: "slow", reason: "Docker did not answer within 15 s; it may still be starting." };
  if (r.exitCode !== 0) return { ok: false, kind: "daemon-down", reason: "The Docker daemon isn't running." };
  return { ok: true, version: r.stdout.trim() };
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
// build log, and waits for it (D-486).

/** The thing that runs the daemon on this computer, in the person's words, and how to start it. */
export type DockerEngine = {
  /** Such as "Docker Desktop". */
  name: string;
  /** The command that starts it; `open -a Docker` on macOS, `colima start`, or the service. */
  command: string[];
  /** What to do when the command ran but the daemon stayed down, such as a permission the person must grant. */
  hint?: string;
};

/** What a start attempt found. `waitedMs` is how long the engine took to answer. */
export type DockerStartResult =
  | { ok: true; version: string; engine: string; waitedMs: number }
  | { ok: false; engine: string | null; reason: string };

const APP_BUNDLES: ReadonlyArray<{ name: string; app: string; context?: string }> = [
  { name: "Docker Desktop", app: "Docker.app", context: "desktop-linux" },
  { name: "OrbStack", app: "OrbStack.app", context: "orbstack" },
];

/** A macOS app is installed when one of the two Applications folders holds it. */
function appInstalled(app: string): boolean {
  return existsSync(join("/Applications", app)) || existsSync(join(homedir(), "Applications", app));
}

/**
 * The `docker` CLI's current context names which engine it would talk to ("desktop-linux", "colima"),
 * which picks between two installed engines. It reads local config, so it answers with the daemon down.
 */
async function contextName(): Promise<string | null> {
  const r = await capture(["docker", "context", "show"], { timeoutMs: 5_000 });
  return r.exitCode === 0 ? r.stdout.trim() || null : null;
}

/** The socket a context points at, such as `unix:///Users/you/.colima/default/docker.sock`; it names Colima's profile. */
async function contextHost(name: string): Promise<string | null> {
  const r = await capture(["docker", "context", "inspect", name, "--format", "{{.Endpoints.docker.Host}}"], { timeoutMs: 5_000 });
  return r.exitCode === 0 ? r.stdout.trim() || null : null;
}

/**
 * Colima runs Docker inside a VM. When the VM is up but the daemon inside it is wedged (a stale socket,
 * an engine that stopped with the VM), `colima start` says "already running" and changes nothing, so a
 * running VM is restarted instead; that is the fix recorded in docs/research/workload-evaluator.md.
 */
export async function colimaEngine(context: string | null, over: { has?: (command: string) => boolean; running?: (profile: string) => Promise<boolean>; host?: (name: string) => Promise<string | null> } = {}): Promise<DockerEngine | null> {
  const has = over.has ?? ((command: string) => which(command) !== null);
  if (!has("colima")) return null;
  const host = await (over.host ?? contextHost)(context ?? "colima");
  const profile = host?.match(/\/\.colima\/([^/]+)\/docker\.sock/)?.[1] ?? null;
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

/**
 * Finds what starts the daemon here, or null when nothing can (docker is missing, or the engine is one
 * keyloom has never started on this platform). Overridable so a test never launches an app.
 */
export async function detectDockerEngine(over: { platform?: NodeJS.Platform; installed?: (app: string) => boolean; has?: (command: string) => boolean; context?: () => Promise<string | null>; colima?: (context: string | null) => Promise<DockerEngine | null> } = {}): Promise<DockerEngine | null> {
  const platform = over.platform ?? process.platform;
  const installed = over.installed ?? appInstalled;
  const has = over.has ?? ((command: string) => which(command) !== null);
  const context = over.context ?? contextName;
  const colima = over.colima ?? ((name: string | null) => colimaEngine(name, { has }));

  if (platform === "darwin" || platform === "linux") {
    const named = await context();
    const colimaContext = named !== null && named.startsWith("colima");
    if (colimaContext) {
      const engine = await colima(named);
      if (engine !== null) return engine;
    }
    if (platform === "linux") {
      if (has("systemctl")) {
        return {
          name: "the Docker service",
          command: ["systemctl", "start", "docker"],
          hint: "if it asked for a password, run `sudo systemctl start docker` in a terminal and build again",
        };
      }
      return colima(named);
    }
    const bundles = APP_BUNDLES.filter((b) => installed(b.app));
    // The context the CLI points at wins; otherwise the first bundle found, Docker Desktop before OrbStack.
    const chosen = bundles.find((b) => named !== null && b.context === named) ?? bundles[0];
    if (chosen) return { name: chosen.name, command: ["open", "-a", chosen.name] };
    return colima(named);
  }
  return null;
}

export type StartDockerOptions = {
  /** How long the engine may take to answer before keyloom gives up; a cold Docker Desktop takes 15-40 s. */
  timeoutMs?: number;
  /** How often to ask the daemon again while it starts. */
  pollMs?: number;
  /** Runs the start command; the real one does. A test passes a fake. */
  start?: (engine: DockerEngine) => Promise<{ ok: boolean; detail?: string }>;
  /** Asks the daemon; the real one does. */
  status?: () => Promise<DockerStatus>;
  /** Finds the engine; the real one does. */
  detect?: () => Promise<DockerEngine | null>;
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
export async function startDockerEngine(opts: StartDockerOptions = {}): Promise<DockerStartResult> {
  const status = opts.status ?? (() => dockerStatus(5_000));
  const detect = opts.detect ?? (() => detectDockerEngine());
  const start = opts.start ?? ((engine: DockerEngine) => runStart(engine));
  const sleep = opts.sleep ?? wait;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const startedAt = Date.now();

  const first = await status();
  if (first.ok) return { ok: true, version: first.version, engine: "the Docker daemon", waitedMs: 0 };
  if (first.kind === "not-installed") return { ok: false, engine: null, reason: first.reason };

  const engine = await detect();
  if (engine === null) return { ok: false, engine: null, reason: first.reason };
  const action = engine.command.includes("restart") ? "restarting" : engine.command.some((part) => part === "start" || part === "-a") ? "starting" : "waking";
  opts.onProgress?.(`keyloom: Docker isn't answering, so ${action} ${engine.name} (a cold start can take half a minute)`);
  const launched = await start(engine);
  if (!launched.ok) {
    return { ok: false, engine: engine.name, reason: `keyloom couldn't start ${engine.name}${launched.detail ? `: ${launched.detail}` : ""}${engine.hint ? `. ${engine.hint}` : ""}` };
  }

  while (Date.now() - startedAt < timeoutMs) {
    if (opts.signal?.aborted) return { ok: false, engine: engine.name, reason: `Stopped waiting for ${engine.name}.` };
    await sleep(pollMs, opts.signal);
    const next = await status();
    if (next.ok) {
      const waitedMs = Date.now() - startedAt;
      opts.onProgress?.(`keyloom: ${engine.name} is up after ${Math.round(waitedMs / 1000)} s`);
      return { ok: true, version: next.version, engine: engine.name, waitedMs };
    }
    if (next.kind === "not-installed") return { ok: false, engine: engine.name, reason: next.reason };
  }
  return { ok: false, engine: engine.name, reason: `${engine.name} did not answer within ${Math.round(timeoutMs / 1000)} s. Open it, wait for it to say it is running, then build again.` };
}

/** Runs an engine's start command and waits for it, which for `open -a` returns once the app has launched. */
async function runStart(engine: DockerEngine): Promise<{ ok: boolean; detail?: string }> {
  const [command, ...args] = engine.command;
  if (command === undefined || which(command) === null) return { ok: false, detail: `${engine.command[0]} is not on PATH` };
  const r = await capture([command, ...args], { timeoutMs: 60_000 });
  if (r.exitCode === 0) return { ok: true };
  const said = (r.stderr || r.stdout).trim().split("\n").at(-1);
  return { ok: false, detail: said || (r.timedOut ? "it did not start in time" : `it exited with code ${r.exitCode}`) };
}
