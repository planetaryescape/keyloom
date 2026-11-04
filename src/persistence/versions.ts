// Versions (25, D-301): the revisions that went onto a keyboard, recorded when a flash verifies, and revisions BK named.
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "./ids.ts";

export type VersionRow = {
  id: string;
  layoutId: string;
  revisionId: string;
  boardId: string;
  name: string | null;
  /** When a flash verified this revision on the keyboard; null for a revision that was only named. */
  putOnAt: number | null;
  /** When a later verified flash replaced it; null while it is still the one on the keyboard (or never was). */
  endedAt: number | null;
  syncId: string | null;
  createdAt: number;
};

type VersionDb = {
  id: string; layout_id: string; revision_id: string; board_id: string; name: string | null; put_on_at: number | null; ended_at: number | null;
  sync_id: string | null; created_at: number;
};

const toVersion = (r: VersionDb): VersionRow => ({
  id: r.id, layoutId: r.layout_id, revisionId: r.revision_id, boardId: r.board_id, name: r.name, putOnAt: r.put_on_at, endedAt: r.ended_at, syncId: r.sync_id, createdAt: r.created_at,
});

/**
 * A flash of `revisionId` verified on `boardId`: everything else recorded on that board's keyboard ended, and this revision's
 * version is (re)opened. `syncId` is null for a verified standalone flash. The caller runs this in the transaction that records
 * the successful flash or sync, so history follows verified firmware, not one particular workflow.
 */
export function recordVersion(db: Database, input: { layoutId: string; revisionId: string; boardId: string; syncId: string | null; at: number }): void {
  db.query("UPDATE versions SET ended_at = ? WHERE board_id = ? AND put_on_at IS NOT NULL AND ended_at IS NULL AND NOT (layout_id = ? AND revision_id = ?)").run(
    input.at, input.boardId, input.layoutId, input.revisionId,
  );
  db.query(
    `INSERT INTO versions (id, layout_id, revision_id, board_id, name, put_on_at, ended_at, sync_id, created_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?)
     ON CONFLICT(layout_id, revision_id) DO UPDATE SET board_id = excluded.board_id, put_on_at = excluded.put_on_at, ended_at = NULL, sync_id = excluded.sync_id`,
  ).run(newId("ver"), input.layoutId, input.revisionId, input.boardId, input.at, input.syncId, input.at);
}

/** Names a revision as a version, creating the version when it was never put on a keyboard. An empty name clears it. */
export function nameVersion(db: Database, input: { layoutId: string; revisionId: string; boardId: string; name: string | null; now?: number }): VersionRow | undefined {
  const now = input.now ?? Date.now();
  db.query(
    `INSERT INTO versions (id, layout_id, revision_id, board_id, name, put_on_at, ended_at, sync_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
     ON CONFLICT(layout_id, revision_id) DO UPDATE SET name = excluded.name`,
  ).run(newId("ver"), input.layoutId, input.revisionId, input.boardId, input.name, now);
  // A name removed from a revision that never went on a keyboard leaves nothing worth keeping.
  if (input.name === null) db.query("DELETE FROM versions WHERE layout_id = ? AND revision_id = ? AND put_on_at IS NULL").run(input.layoutId, input.revisionId);
  return findVersionOfRevision(db, input.layoutId, input.revisionId);
}

export function findVersion(db: Database, id: string): VersionRow | undefined {
  const row = db.query("SELECT * FROM versions WHERE id = ?").get(id) as VersionDb | null;
  return row ? toVersion(row) : undefined;
}

export function findVersionOfRevision(db: Database, layoutId: string, revisionId: string): VersionRow | undefined {
  const row = db.query("SELECT * FROM versions WHERE layout_id = ? AND revision_id = ?").get(layoutId, revisionId) as VersionDb | null;
  return row ? toVersion(row) : undefined;
}

/** The last revision verified on a board, regardless of whether it was put on by Sync or a standalone flash. */
export function latestVerifiedVersionOnBoard(db: Database, boardId: string): VersionRow | undefined {
  const row = db.query("SELECT * FROM versions WHERE board_id = ? AND put_on_at IS NOT NULL AND ended_at IS NULL ORDER BY put_on_at DESC, id DESC LIMIT 1").get(boardId) as VersionDb | null;
  return row ? toVersion(row) : undefined;
}

/** Repairs successful marker-verified flashes recorded before standalone flashes updated version history. */
export function reconcileVerifiedFlashVersions(db: Database, dataDir: string): number {
  const flashes = db.query(
    `SELECT f.build_id, f.log_path, f.finished_at, b.revision_id, r.layout_id, l.board_id
     FROM flashes f JOIN builds b ON b.id = f.build_id
     JOIN revisions r ON r.id = b.revision_id JOIN layouts l ON l.id = r.layout_id
     WHERE f.status = 'succeeded' AND f.finished_at IS NOT NULL
       AND f.finished_at > COALESCE((SELECT MAX(v.put_on_at) FROM versions v
         WHERE v.board_id = l.board_id AND v.put_on_at IS NOT NULL AND v.ended_at IS NULL), 0)
     ORDER BY f.finished_at, f.id`,
  ).all() as { build_id: string; log_path: string; finished_at: number; revision_id: string; layout_id: string; board_id: string }[];
  const marked = flashes.filter((flash) => {
    try {
      return readFileSync(join(dataDir, flash.log_path), "utf8")
        .split(/\r?\n/)
        .some((line) => line.startsWith("keyloom: Verified:") && line.includes(`build ${flash.build_id}`));
    } catch {
      return false;
    }
  });
  return db.transaction(() => {
    let recorded = 0;
    for (const flash of marked) {
      const latest = latestVerifiedVersionOnBoard(db, flash.board_id);
      if (latest?.putOnAt !== null && latest?.putOnAt !== undefined && latest.putOnAt >= flash.finished_at) continue;
      recordVersion(db, {
        layoutId: flash.layout_id, revisionId: flash.revision_id, boardId: flash.board_id, syncId: null, at: flash.finished_at,
      });
      recorded++;
    }
    return recorded;
  })();
}

/** A layout's versions; the caller orders them by the revision line, which is the order that means something. */
export function listVersionRows(db: Database, layoutId: string): VersionRow[] {
  return (db.query("SELECT * FROM versions WHERE layout_id = ?").all(layoutId) as VersionDb[]).map(toVersion);
}
