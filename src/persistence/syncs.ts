// Repositories for keyboard sync (17): the syncs themselves and what BK chose about auto-sync per board.
// Every write to a sync that is still running is guarded by its status, so a finish and a late progress
// write can't both win, and two processes claiming at once can't both start.
import type { Database } from "bun:sqlite";
import { newId } from "./ids.ts";
import { transact } from "./transaction.ts";

export type SyncStatus = "building" | "flashing" | "succeeded" | "failed" | "cancelled";
export type SyncTrigger = "auto" | "manual";

/**
 * Why a sync did not finish. `build`, `flash`, `verify` and `needs_hand` stop the same revision being tried again by
 * itself, because trying again would do the same thing; the others say the world changed, so trying again is right.
 */
export type SyncFailure = "build" | "flash" | "verify" | "needs_hand" | "disconnected" | "interrupted" | "superseded" | "cancelled";

export const RETRYABLE_FAILURES: readonly SyncFailure[] = ["disconnected", "interrupted", "superseded", "cancelled"];

export type SyncStep = "building" | "restarting" | "writing" | "verifying" | "needs_hand" | "done";

export type SyncRow = {
  id: string;
  boardId: string;
  layoutId: string;
  revisionId: string;
  boardRevision: string;
  trigger: SyncTrigger;
  status: SyncStatus;
  step: SyncStep;
  /** What the person must do now, while the step is `needs_hand`. */
  instruction: string | null;
  failure: SyncFailure | null;
  error: string | null;
  buildId: string | null;
  flashId: string | null;
  logPath: string;
  pid: number;
  owner: string;
  /** When the revision being synced was applied: the start of the time BK waits. */
  appliedAt: number;
  startedAt: number;
  builtAt: number | null;
  flashStartedAt: number | null;
  finishedAt: number | null;
};

type SyncDb = {
  id: string; board_id: string; layout_id: string; revision_id: string; board_revision: string; trigger: SyncTrigger; status: SyncStatus; step: SyncStep;
  instruction: string | null; failure: SyncFailure | null; error: string | null; build_id: string | null; flash_id: string | null; log_path: string; pid: number;
  owner: string; applied_at: number; started_at: number; built_at: number | null; flash_started_at: number | null; finished_at: number | null;
};

const toSync = (r: SyncDb): SyncRow => ({
  id: r.id, boardId: r.board_id, layoutId: r.layout_id, revisionId: r.revision_id, boardRevision: r.board_revision, trigger: r.trigger, status: r.status,
  step: r.step, instruction: r.instruction, failure: r.failure, error: r.error, buildId: r.build_id, flashId: r.flash_id, logPath: r.log_path, pid: r.pid,
  owner: r.owner, appliedAt: r.applied_at, startedAt: r.started_at, builtAt: r.built_at, flashStartedAt: r.flash_started_at, finishedAt: r.finished_at,
});

const ACTIVE = "status IN ('building','flashing')";
export const isActive = (row: Pick<SyncRow, "status">): boolean => row.status === "building" || row.status === "flashing";

export const newSyncId = (): string => newId("syn");

export type ClaimInput = {
  id: string;
  boardId: string;
  layoutId: string;
  revisionId: string;
  boardRevision: string;
  trigger: SyncTrigger;
  logPath: string;
  appliedAt: number;
  owner: string;
  pid?: number;
  now?: number;
};

export type Claim = { claimed: SyncRow } | { busy: SyncRow };

/**
 * Starts a sync unless one is already running anywhere (two builds never run at once, in this process or another).
 * A row whose process has gone is finished as interrupted first, in the same write transaction, so a crash can't block the queue.
 */
export function claimSync(db: Database, input: ClaimInput, alive: (pid: number) => boolean): Claim {
  const now = input.now ?? Date.now();
  const pid = input.pid ?? process.pid;
  return transact(db, () => {
    for (const row of activeSyncs(db)) {
      // A row in a live process is not ours to judge. A stopped engine of this very process is left to the next engine's recovery.
      if (alive(row.pid)) return { busy: row } as const;
      finishSync(db, row.id, { status: "failed", failure: "interrupted", error: "keyloom stopped before this sync finished." }, now);
    }
    db.query(
      `INSERT INTO syncs (id, board_id, layout_id, revision_id, board_revision, trigger, status, step, instruction, failure, error, build_id, flash_id, log_path, pid, owner,
                          applied_at, started_at, built_at, flash_started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, 'building', 'building', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(input.id, input.boardId, input.layoutId, input.revisionId, input.boardRevision, input.trigger, input.logPath, pid, input.owner, input.appliedAt, now);
    return { claimed: findSync(db, input.id) as SyncRow };
  });
}

export function findSync(db: Database, id: string): SyncRow | undefined {
  const row = db.query("SELECT * FROM syncs WHERE id = ?").get(id) as SyncDb | null;
  return row ? toSync(row) : undefined;
}

export function activeSyncs(db: Database): SyncRow[] {
  return (db.query(`SELECT * FROM syncs WHERE ${ACTIVE} ORDER BY started_at`).all() as SyncDb[]).map(toSync);
}

export type SyncProgress = Partial<Pick<SyncRow, "step" | "instruction" | "buildId" | "flashId" | "builtAt" | "flashStartedAt">> & { status?: "building" | "flashing" };

const COLUMNS: Record<keyof SyncProgress, string> = {
  step: "step", instruction: "instruction", buildId: "build_id", flashId: "flash_id", builtAt: "built_at", flashStartedAt: "flash_started_at", status: "status",
};

/** Records progress of a sync that is still running; a sync that already finished is left alone. Returns whether it was written. */
export function progressSync(db: Database, id: string, patch: SyncProgress): boolean {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as Array<[keyof SyncProgress, unknown]>;
  if (entries.length === 0) return true;
  const sets = entries.map(([k]) => `${COLUMNS[k]} = ?`).join(", ");
  const r = db.query(`UPDATE syncs SET ${sets} WHERE id = ? AND ${ACTIVE}`).run(...(entries.map(([, v]) => v) as never[]), id);
  return r.changes > 0;
}

export type SyncFinish =
  | { status: "succeeded" }
  | { status: "failed" | "cancelled"; failure: SyncFailure; error: string };

/** Finishes a sync that is still running. Only the first finish counts; returns whether this one did. */
export function finishSync(db: Database, id: string, result: SyncFinish, now = Date.now()): boolean {
  const r =
    result.status === "succeeded"
      ? db.query(`UPDATE syncs SET status = 'succeeded', step = 'done', instruction = NULL, finished_at = ? WHERE id = ? AND ${ACTIVE}`).run(now, id)
      : db.query(`UPDATE syncs SET status = ?, step = 'done', instruction = CASE WHEN ? = 'needs_hand' THEN instruction ELSE NULL END, failure = ?, error = ?, finished_at = ? WHERE id = ? AND ${ACTIVE}`).run(result.status, result.failure, result.failure, result.error, now, id);
  return r.changes > 0;
}

/** The newest sync of `layoutId` to `boardId` for each revision named, newest first; used to tell whether a revision was already tried. */
export function lastSyncOfRevision(db: Database, boardId: string, revisionId: string): SyncRow | undefined {
  const row = db.query("SELECT * FROM syncs WHERE board_id = ? AND revision_id = ? ORDER BY started_at DESC, id DESC LIMIT 1").get(boardId, revisionId) as SyncDb | null;
  return row ? toSync(row) : undefined;
}

export function lastSyncOfBoard(db: Database, boardId: string): SyncRow | undefined {
  const row = db.query("SELECT * FROM syncs WHERE board_id = ? ORDER BY started_at DESC, id DESC LIMIT 1").get(boardId) as SyncDb | null;
  return row ? toSync(row) : undefined;
}

export function lastSucceededSync(db: Database, boardId: string): SyncRow | undefined {
  const row = db.query("SELECT * FROM syncs WHERE board_id = ? AND status = 'succeeded' ORDER BY finished_at DESC, id DESC LIMIT 1").get(boardId) as SyncDb | null;
  return row ? toSync(row) : undefined;
}

export function recentSyncs(db: Database, limit = 20): SyncRow[] {
  return (db.query("SELECT * FROM syncs ORDER BY started_at DESC, id DESC LIMIT ?").all(limit) as SyncDb[]).map(toSync);
}

// --- what BK chose per board ---------------------------------------------------------------

export type BoardSyncRow = {
  boardId: string;
  /** null: BK has not chosen, so auto-sync follows the proof. */
  autoSync: boolean | null;
  paused: boolean;
  provenAt: number | null;
  provenBuildId: string | null;
};

type BoardSyncDb = { board_id: string; auto_sync: number | null; paused: number; proven_at: number | null; proven_build_id: string | null };

export function getBoardSync(db: Database, boardId: string): BoardSyncRow {
  const r = db.query("SELECT * FROM board_sync WHERE board_id = ?").get(boardId) as BoardSyncDb | null;
  return r
    ? { boardId, autoSync: r.auto_sync === null ? null : r.auto_sync === 1, paused: r.paused === 1, provenAt: r.proven_at, provenBuildId: r.proven_build_id }
    : { boardId, autoSync: null, paused: false, provenAt: null, provenBuildId: null };
}

const ensureBoard = (db: Database, boardId: string): void => {
  db.query("INSERT OR IGNORE INTO board_sync (board_id) VALUES (?)").run(boardId);
};

export function setAutoSyncChoice(db: Database, boardId: string, on: boolean): void {
  ensureBoard(db, boardId);
  db.query("UPDATE board_sync SET auto_sync = ? WHERE board_id = ?").run(on ? 1 : 0, boardId);
}

export function setPaused(db: Database, boardId: string, paused: boolean): void {
  ensureBoard(db, boardId);
  db.query("UPDATE board_sync SET paused = ? WHERE board_id = ?").run(paused ? 1 : 0, boardId);
}

/** A flash on this board was verified through the hands-free path. The first proof's time is kept; the build is the latest. */
export function recordHandsFreeProof(db: Database, boardId: string, buildId: string, now = Date.now()): void {
  ensureBoard(db, boardId);
  db.query("UPDATE board_sync SET proven_at = COALESCE(proven_at, ?), proven_build_id = ? WHERE board_id = ?").run(now, buildId, boardId);
}

// --- reads a sync needs from the revision history --------------------------------------------

/** The revision IDs from `fromRevisionId` back to the first, newest first. A revision that has no parent in the table ends the walk. */
export function revisionLine(db: Database, layoutId: string, fromRevisionId: string): string[] {
  const rows = db.query("SELECT id, parent_id FROM revisions WHERE layout_id = ?").all(layoutId) as Array<{ id: string; parent_id: string | null }>;
  const parent = new Map(rows.map((r) => [r.id, r.parent_id]));
  const line: string[] = [];
  for (let at: string | null | undefined = fromRevisionId; at !== null && at !== undefined && line.length <= rows.length; at = parent.get(at)) line.push(at);
  return line;
}
