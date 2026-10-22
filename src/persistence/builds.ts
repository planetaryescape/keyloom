// Repositories for builds and flashes (02). Paths are stored relative to the data directory.
import type { Database } from "bun:sqlite";
import { newId } from "./ids.ts";

export type BuildStatus = "running" | "succeeded" | "failed";
export type FlashStatus = "waiting_for_bootloader" | "writing" | "succeeded" | "failed";

export type BuildRow = {
  id: string;
  revisionId: string;
  layoutId: string;
  boardRevision: string;
  status: BuildStatus;
  artifactPath: string | null;
  logPath: string;
  error: string | null;
  pid: number;
  startedAt: number;
  finishedAt: number | null;
};

export type FlashRow = {
  id: string;
  buildId: string;
  status: FlashStatus;
  error: string | null;
  logPath: string;
  pid: number;
  startedAt: number;
  finishedAt: number | null;
};

type BuildDb = {
  id: string; revision_id: string; layout_id: string; board_revision: string; status: BuildStatus; artifact_path: string | null; log_path: string;
  error: string | null; pid: number; started_at: number; finished_at: number | null;
};
type FlashDb = {
  id: string; build_id: string; status: FlashStatus; error: string | null; log_path: string; pid: number; started_at: number; finished_at: number | null;
};

const toBuild = (r: BuildDb): BuildRow => ({
  id: r.id, revisionId: r.revision_id, layoutId: r.layout_id, boardRevision: r.board_revision, status: r.status, artifactPath: r.artifact_path, logPath: r.log_path,
  error: r.error, pid: r.pid, startedAt: r.started_at, finishedAt: r.finished_at,
});
const toFlash = (r: FlashDb): FlashRow => ({
  id: r.id, buildId: r.build_id, status: r.status, error: r.error, logPath: r.log_path, pid: r.pid, startedAt: r.started_at, finishedAt: r.finished_at,
});

/** The id is made before the row, so the log path can name it. */
export const newBuildId = (): string => newId("bld");
export const newFlashId = (): string => newId("fl");

export function createBuild(
  db: Database,
  input: { id: string; revisionId: string; layoutId: string; boardRevision: string; logPath: string; pid?: number; now?: number },
): BuildRow {
  const now = input.now ?? Date.now();
  const pid = input.pid ?? process.pid;
  db.query(
    "INSERT INTO builds (id, revision_id, board_revision, status, artifact_path, log_path, error, pid, started_at, finished_at) VALUES (?, ?, ?, 'running', NULL, ?, NULL, ?, ?, NULL)",
  ).run(input.id, input.revisionId, input.boardRevision, input.logPath, pid, now);
  return { id: input.id, revisionId: input.revisionId, layoutId: input.layoutId, boardRevision: input.boardRevision, status: "running", artifactPath: null, logPath: input.logPath, error: null, pid, startedAt: now, finishedAt: null };
}

export function finishBuild(db: Database, id: string, result: { error: string } | { artifactPath: string }, now = Date.now()): void {
  if ("error" in result) {
    db.query("UPDATE builds SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(result.error, now, id);
  } else {
    db.query("UPDATE builds SET status = 'succeeded', artifact_path = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(result.artifactPath, now, id);
  }
}

export function findBuild(db: Database, id: string): BuildRow | undefined {
  const row = db.query("SELECT b.*, r.layout_id FROM builds b JOIN revisions r ON r.id = b.revision_id WHERE b.id = ?").get(id) as BuildDb | null;
  return row ? toBuild(row) : undefined;
}

/** The newest successful build of any revision of `layoutId`. */
export function latestSuccessfulBuild(db: Database, layoutId: string): BuildRow | undefined {
  const row = db
    .query(
      `SELECT b.*, r.layout_id FROM builds b JOIN revisions r ON r.id = b.revision_id
       WHERE r.layout_id = ? AND b.status = 'succeeded' ORDER BY b.finished_at DESC, b.id DESC LIMIT 1`,
    )
    .get(layoutId) as BuildDb | null;
  return row ? toBuild(row) : undefined;
}

export function createFlash(db: Database, input: { id: string; buildId: string; logPath: string; pid?: number; now?: number }): FlashRow {
  const now = input.now ?? Date.now();
  const pid = input.pid ?? process.pid;
  db.query(
    "INSERT INTO flashes (id, build_id, status, error, log_path, pid, started_at, finished_at) VALUES (?, ?, 'waiting_for_bootloader', NULL, ?, ?, ?, NULL)",
  ).run(input.id, input.buildId, input.logPath, pid, now);
  return { id: input.id, buildId: input.buildId, status: "waiting_for_bootloader", error: null, logPath: input.logPath, pid, startedAt: now, finishedAt: null };
}

/** Moves a flash that is still in progress between its two live states. */
export function setFlashProgress(db: Database, id: string, status: "waiting_for_bootloader" | "writing"): void {
  db.query("UPDATE flashes SET status = ? WHERE id = ? AND status IN ('waiting_for_bootloader','writing')").run(status, id);
}

export function finishFlash(db: Database, id: string, result: { error: string } | null, now = Date.now()): void {
  if (result) db.query("UPDATE flashes SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status IN ('waiting_for_bootloader','writing')").run(result.error, now, id);
  else db.query("UPDATE flashes SET status = 'succeeded', finished_at = ? WHERE id = ? AND status IN ('waiting_for_bootloader','writing')").run(now, id);
}

export function findFlash(db: Database, id: string): FlashRow | undefined {
  const row = db.query("SELECT * FROM flashes WHERE id = ?").get(id) as FlashDb | null;
  return row ? toFlash(row) : undefined;
}

/** A flash that has not finished, if any: only one board can be in its bootloader at a time. */
export function activeFlashes(db: Database): FlashRow[] {
  return (db.query("SELECT * FROM flashes WHERE status IN ('waiting_for_bootloader','writing') ORDER BY started_at").all() as FlashDb[]).map(toFlash);
}

/** Successful flashes of any revision of `layoutId`, oldest build first: when each build began and the flash finished. */
export function successfulFlashes(db: Database, layoutId: string): { buildStartedAt: number; flashedAt: number }[] {
  const rows = db
    .query(
      `SELECT b.started_at AS build_started_at, f.finished_at AS flashed_at FROM flashes f
       JOIN builds b ON b.id = f.build_id JOIN revisions r ON r.id = b.revision_id
       WHERE r.layout_id = ? AND f.status = 'succeeded' AND f.finished_at IS NOT NULL ORDER BY b.started_at, f.id`,
    )
    .all(layoutId) as { build_started_at: number; flashed_at: number }[];
  return rows.map((r) => ({ buildStartedAt: r.build_started_at, flashedAt: r.flashed_at }));
}

/** The newest successful build of exactly this revision for this board revision, so a sync that failed after its build can flash it again instead of building twice. */
export function latestSuccessfulBuildOfRevision(db: Database, revisionId: string, boardRevision: string): BuildRow | undefined {
  const row = db
    .query(
      `SELECT b.*, r.layout_id FROM builds b JOIN revisions r ON r.id = b.revision_id
       WHERE b.revision_id = ? AND b.board_revision = ? AND b.status = 'succeeded' ORDER BY b.finished_at DESC, b.id DESC LIMIT 1`,
    )
    .get(revisionId, boardRevision) as BuildDb | null;
  return row ? toBuild(row) : undefined;
}

/**
 * The build a keyboard's marker names. A marker holds only the last 12 characters of the build's ID (src/firmware/qmk/handsfree.ts),
 * which are random, so a match is the build unless two collide; then none is returned, because naming the wrong one would sync against the wrong revision.
 */
export function findBuildByKey(db: Database, key: string): BuildRow | undefined {
  if (!/^[0-9A-Z]{12}$/.test(key)) return undefined;
  const rows = db.query("SELECT b.*, r.layout_id FROM builds b JOIN revisions r ON r.id = b.revision_id WHERE substr(b.id, -12) = ? LIMIT 2").all(key) as BuildDb[];
  return rows.length === 1 ? toBuild(rows[0] as BuildDb) : undefined;
}

/** A later successful flash can supersede a sync failure when the whole keyboard is observed running this build. */
export function lastSuccessfulFlashAt(db: Database, buildId: string): number | undefined {
  const row = db.query("SELECT MAX(finished_at) AS at FROM flashes WHERE build_id = ? AND status = 'succeeded'").get(buildId) as { at: number | null };
  return row.at ?? undefined;
}
