// Firmware is built in Docker, so "is the daemon up" is part of keyloom working rather than a prerequisite
// the person has to keep in mind. This asks, and starts the engine it finds when it isn't (D-486).
import { type DockerEngine, type DockerProblem, type DockerStartResult, type DockerStatus, detectDockerEngine, dockerStatus, startDockerEngine } from "../firmware/toolchain/docker.ts";

/** What the UI and `doctor` show: whether a build can run now, and what would fix it if not. */
export type DockerReadiness =
  | { ok: true; version: string; engine: string; autoStart: boolean }
  | { ok: false; problem: DockerProblem; reason: string; engine: string | null; canStart: boolean; autoStart: boolean };

/** The parts a test replaces, so no test launches an app or talks to a daemon. */
export type ToolchainOverrides = {
  status?: () => Promise<DockerStatus>;
  detect?: () => Promise<DockerEngine | null>;
  startEngine?: (opts: Parameters<typeof startDockerEngine>[0]) => Promise<DockerStartResult>;
  /** The process's environment, for the opt-out below. */
  env?: Record<string, string | undefined>;
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
  // An engine keyloom knows how to start is named only when starting could help: a missing docker CLI is an install.
  const engine = now.kind === "not-installed" ? null : await (over.detect ?? detectDockerEngine)();
  return {
    ok: false, problem: now.kind, reason: now.reason,
    engine: engine?.name ?? null,
    canStart: autoStart && engine !== null,
    autoStart,
  };
}

/** Starts the engine and waits for it, whatever the person's setting says: what an explicit click or flag asks for. */
export async function startDocker(opts: { onProgress?: (line: string) => void; signal?: AbortSignal; overrides?: ToolchainOverrides } = {}): Promise<DockerStartResult> {
  const over = opts.overrides ?? {};
  const start = over.startEngine ?? startDockerEngine;
  return start({
    ...(over.status === undefined ? {} : { status: over.status }),
    ...(over.detect === undefined ? {} : { detect: over.detect }),
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
  // Nothing to start when the docker CLI isn't there at all: that is an install, not a wake-up.
  if (now.kind === "not-installed") return { ok: false, engine: null, reason: now.reason };
  if (!dockerAutoStart(over.env ?? process.env)) {
    return {
      ok: false, engine: null,
      reason: `${now.reason.replace(/\.$/, "")}, and keyloom is set not to start it (KEYLOOM_DOCKER_AUTOSTART=0). Start it, then build again.`,
    };
  }
  const start = over.startEngine ?? startDockerEngine;
  const result = await start({
    status,
    ...(over.detect === undefined ? {} : { detect: over.detect }),
    ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
  return result.ok ? { ok: true, started: true, engine: result.engine } : { ok: false, reason: result.reason, engine: result.engine };
}
