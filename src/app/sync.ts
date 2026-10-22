import { requirePlatformSupport } from "../firmware/toolchain/platform-support.ts";
// Use cases for keyboard sync (17, 10#commands): the engine the server runs, and the one-shot commands the CLI calls
// against the same database. A one-shot `sync` is the same engine without its timer: it starts one sync and waits.
import type { App } from "./context.ts";
import { BuildFailedError, FlashFailedError } from "./firmware-errors.ts";
import { type DefaultDepsOptions, type SyncDeps, appSyncDeps } from "./sync-deps.ts";
import { type BoardSyncView, SyncEngine, type SyncOptions } from "./sync-engine.ts";
import { activeSyncs, findSync, type BoardSyncRow, type SyncRow } from "../persistence/syncs.ts";
import { processAlive } from "../firmware/toolchain/lock.ts";
import { logsDir } from "../persistence/paths.ts";
import { join } from "node:path";
import { UsageError } from "./errors.ts";

export type { BoardSyncView, SyncEngine, SyncNowResult, SyncOptions, SyncRunView, SyncTimings } from "./sync-engine.ts";
export type { SyncState } from "./sync-state.ts";
export type { DefaultDepsOptions, SyncDeps } from "./sync-deps.ts";

export type SyncSetup = DefaultDepsOptions & SyncOptions & { deps?: SyncDeps };

/** The engine `keyloom serve` runs; tests and demos pass fake deps or fake USB. */
export function createSyncEngine(app: App, setup: SyncSetup = {}): SyncEngine {
  requirePlatformSupport("keyloom sync");
  const { deps, handsFree, volumesRoot, bootloaderWaitMs, ...options } = setup;
  return new SyncEngine(app, deps ?? appSyncDeps(app, { ...(handsFree ? { handsFree } : {}), ...(volumesRoot === undefined ? {} : { volumesRoot }), ...(bootloaderWaitMs === undefined ? {} : { bootloaderWaitMs }) }), options);
}

/** `keyloom sync status`: each board's state, from a fresh look at USB. */
export async function syncStatus(app: App, setup: SyncSetup = {}): Promise<BoardSyncView[]> {
  return createSyncEngine(app, setup).snapshot();
}

export type SyncOutcome = {
  status: "in_sync" | "synced";
  boardId: string;
  layoutId: string;
  revisionId: string;
  sync: SyncRow | null;
};

export type RunSyncOptions = SyncSetup & {
  /** Wait for a sync that is already running (the server's, or another command's) instead of refusing. */
  wait?: boolean;
  /** Every change of step, for the CLI's progress line. */
  onStep?: (step: string) => void;
  /** Aborting stops a build that has not reached the keyboard; a flash is let finish. */
  signal?: AbortSignal;
  /** How long `wait` waits for the running sync, default 15 minutes. */
  waitTimeoutMs?: number;
  /** Make the config the one on its board's keyboard first (D-300): `keyloom config use`. Without it, a config that isn't already the board's is refused. */
  put?: boolean;
};

const STEP_WORDS = {
  building: "building", restarting: "restarting the keyboard into its bootloader", writing: "writing the firmware", verifying: "waiting for the keyboard to come back", needs_hand: "waiting for you",
} as const;

/**
 * One sync of a layout, and a wait for its end. Throws BuildFailedError (exit 7) when the build fails and FlashFailedError (exit 8) when
 * the keyboard could not be flashed or the flash could not be verified; a keyboard that is already on the head is a success.
 */
export async function runSync(app: App, ref: string, opts: RunSyncOptions = {}): Promise<SyncOutcome> {
  requirePlatformSupport("keyloom sync");
  const engine = createSyncEngine(app, opts);
  const stop = () => void engine.stop({ flashGraceMs: 10 * 60_000 });
  opts.signal?.addEventListener("abort", stop, { once: true });
  try {
    if (opts.wait) await waitForOthers(app, opts.waitTimeoutMs ?? 15 * 60_000, opts.signal);
    const result = await (opts.put ? engine.useConfig(ref) : engine.syncNow(ref));
    if (result.kind === "in_sync") {
      return { status: "in_sync", boardId: result.boardId, layoutId: result.layoutId, revisionId: result.revisionId, sync: null };
    }
    if (result.kind === "queued") throw new UsageError("a sync is already running in this process; wait for it");
    const poll = setInterval(() => {
      const row = findSync(app.db, result.sync.id);
      if (row && (row.status === "building" || row.status === "flashing")) opts.onStep?.(STEP_WORDS[row.step as keyof typeof STEP_WORDS] ?? row.step);
    }, 500);
    let done: SyncRow;
    try {
      done = await result.done;
    } finally {
      clearInterval(poll);
    }
    if (done.status === "succeeded") return { status: "synced", boardId: done.boardId, layoutId: done.layoutId, revisionId: done.revisionId, sync: done };
    const log = join(logsDir(app.dataDir), `sync-${done.id}.log`);
    const message = `sync ${done.id} ${done.status === "cancelled" ? "was cancelled" : "failed"}: ${done.error ?? "unknown error"} (log: ${log})`;
    if (done.failure === "build") throw new BuildFailedError(message, done.buildId ?? done.id, log);
    throw new FlashFailedError(message, done.flashId ?? done.id, log);
  } finally {
    opts.signal?.removeEventListener("abort", stop);
  }
}

/** `keyloom config use`: makes the config the one on its keyboard and syncs it once, with `runSync`'s checks and outcomes. */
export const runUseConfig = (app: App, ref: string, opts: RunSyncOptions = {}): Promise<SyncOutcome> => runSync(app, ref, { ...opts, put: true });

async function waitForOthers(app: App, timeoutMs: number, signal: AbortSignal | undefined): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (activeSyncs(app.db).some((s) => processAlive(s.pid))) {
    if (signal?.aborted) return;
    if (Date.now() > deadline) throw new UsageError("the sync that was running did not finish in time");
    await Bun.sleep(500);
  }
}

export type AutoSyncReport = { boardId: string; boardName: string; on: boolean; choice: boolean | null; paused: boolean; proven: boolean; provenAt: number | null };

function report(engine: SyncEngine, boardId: string, row: BoardSyncRow): AutoSyncReport {
  const view = engine.views().find((v) => v.boardId === boardId);
  return {
    boardId, boardName: view?.boardName ?? boardId, on: view?.auto.on ?? false, choice: row.autoSync, paused: row.paused, proven: row.provenAt !== null, provenAt: row.provenAt,
  };
}

export function autoSyncStatus(app: App, boardId: string): AutoSyncReport {
  const engine = createSyncEngine(app, { deps: noKeyboards });
  return report(engine, boardId, engine.settings(boardId));
}

export function setAutoSync(app: App, boardId: string, on: boolean): AutoSyncReport {
  const engine = createSyncEngine(app, { deps: noKeyboards });
  return report(engine, boardId, engine.setAutoSync(boardId, on));
}

export function pauseAutoSync(app: App, boardId: string, paused: boolean): AutoSyncReport {
  const engine = createSyncEngine(app, { deps: noKeyboards });
  return report(engine, boardId, engine.setPaused(boardId, paused));
}

// These three read and write a board's settings only, so they never touch USB.
const noKeyboards: SyncDeps = {
  readKeyboards: async () => new Map(),
  build: async () => ({ ok: false, error: "not used" }),
  flash: async () => ({ ok: false, error: "not used" }),
};
