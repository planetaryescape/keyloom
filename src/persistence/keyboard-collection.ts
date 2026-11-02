import type { Database } from "bun:sqlite";

export function removedKeyboards(db: Database): Map<string, number> {
  const rows = db.query<{ board_id: string; removed_at: number }, []>("SELECT board_id, removed_at FROM keyboard_collection WHERE removed_at IS NOT NULL").all();
  return new Map(rows.map((r) => [r.board_id, r.removed_at]));
}

export function keyboardRemoved(db: Database, boardId: string): boolean {
  return db.query(`SELECT 1 WHERE
    EXISTS (SELECT 1 FROM keyboard_collection WHERE board_id = ? AND removed_at IS NOT NULL)
    OR (EXISTS (SELECT 1 FROM layouts WHERE board_id = ?)
      AND NOT EXISTS (SELECT 1 FROM layouts WHERE board_id = ? AND archived_at IS NULL))`).get(boardId, boardId, boardId) !== null;
}

export function setKeyboardRemoved(db: Database, boardId: string, at: number | null): void {
  db.query("INSERT INTO keyboard_collection (board_id, removed_at) VALUES (?, ?) ON CONFLICT(board_id) DO UPDATE SET removed_at = excluded.removed_at").run(boardId, at);
}
