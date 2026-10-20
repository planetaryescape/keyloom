// Repositories for configs (25): which config is on each keyboard, rename, archive and delete. A config is a layout row;
// these are the writes that are about the config rather than the layout's document.
import type { Database } from "bun:sqlite";
import { NameTakenError } from "./layouts.ts";

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";

/** The config the sync engine keeps on `boardId`'s keyboard, or undefined for a board with no layouts. */
export function getBoardConfig(db: Database, boardId: string): string | undefined {
  return (db.query("SELECT layout_id FROM board_config WHERE board_id = ?").get(boardId) as { layout_id: string } | null)?.layout_id;
}

export function setBoardConfig(db: Database, boardId: string, layoutId: string): void {
  db.query("INSERT INTO board_config (board_id, layout_id) VALUES (?, ?) ON CONFLICT(board_id) DO UPDATE SET layout_id = excluded.layout_id").run(boardId, layoutId);
}

/** Board ID to the ID of the config on its keyboard. */
export function boardConfigs(db: Database): Map<string, string> {
  const rows = db.query("SELECT board_id, layout_id FROM board_config").all() as Array<{ board_id: string; layout_id: string }>;
  return new Map(rows.map((r) => [r.board_id, r.layout_id]));
}

export function renameLayoutRow(db: Database, layoutId: string, name: string): void {
  try {
    db.query("UPDATE layouts SET name = ? WHERE id = ?").run(name, layoutId);
  } catch (err) {
    if (isUniqueViolation(err)) throw new NameTakenError(`a config named "${name}" already exists`);
    throw err;
  }
}

export function setArchivedAt(db: Database, layoutId: string, at: number | null): void {
  db.query("UPDATE layouts SET archived_at = ? WHERE id = ?").run(at, layoutId);
}

/**
 * Removes a config and everything that hangs off it: revisions, change sets, remembered decisions, conversations, versions and the
 * builds and syncs made from it. Build files on disk stay (they are the firmware cache's to prune). Call it inside `transact`.
 */
export function deleteLayoutCascade(db: Database, layoutId: string): void {
  // layouts.head_revision_id, revisions.change_set_id and change_sets.base_revision_id reference each other; check at commit.
  db.run("PRAGMA defer_foreign_keys = ON");
  const revisions = "(SELECT id FROM revisions WHERE layout_id = ?)";
  db.query("DELETE FROM versions WHERE layout_id = ?").run(layoutId);
  // Reviews point at revisions and change sets, so they go first; the previous-review link is inside the set being removed.
  db.query("UPDATE board_reviews SET previous_review_id = NULL WHERE layout_id = ?").run(layoutId);
  db.query("DELETE FROM review_items WHERE review_id IN (SELECT id FROM board_reviews WHERE layout_id = ?)").run(layoutId);
  db.query("DELETE FROM board_reviews WHERE layout_id = ?").run(layoutId);
  db.query("DELETE FROM review_dismissals WHERE layout_id = ?").run(layoutId);
  db.query("UPDATE syncs SET build_id = NULL, flash_id = NULL WHERE layout_id = ?").run(layoutId);
  db.query(`DELETE FROM syncs WHERE layout_id = ? OR revision_id IN ${revisions}`).run(layoutId, layoutId);
  db.query(`DELETE FROM flashes WHERE build_id IN (SELECT id FROM builds WHERE revision_id IN ${revisions})`).run(layoutId);
  db.query(`DELETE FROM builds WHERE revision_id IN ${revisions}`).run(layoutId);
  db.query("UPDATE decisions SET superseded_by = NULL WHERE layout_id = ?").run(layoutId);
  db.query("DELETE FROM decisions WHERE layout_id = ?").run(layoutId);
  db.query("DELETE FROM change_sets WHERE layout_id = ?").run(layoutId);
  db.query("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE layout_id = ?)").run(layoutId);
  db.query("DELETE FROM conversations WHERE layout_id = ?").run(layoutId);
  db.query("DELETE FROM typing_sessions WHERE layout_id = ?").run(layoutId);
  db.query("DELETE FROM revisions WHERE layout_id = ?").run(layoutId);
  db.query("DELETE FROM layouts WHERE id = ?").run(layoutId);
}
