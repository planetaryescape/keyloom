// A layout written the way the first migrations' tables take it, for tests that build a database at an old version and then
// migrate it. createLayout writes columns and tables later migrations add, so it can't run against an old schema.
import type { Database } from "bun:sqlite";
import type { Layout } from "../../src/layout/schema.ts";
import { newId } from "../../src/persistence/ids.ts";

export function createLayoutAtOldSchema(db: Database, input: { name: string; layout: Layout; summary: string }): { layout: { id: string }; revision: { id: string } } {
  const layoutId = newId("lay");
  const revisionId = newId("rev");
  const now = Date.now();
  db.transaction(() => {
    db.run("PRAGMA defer_foreign_keys = ON");
    db.query("INSERT INTO layouts (id, board_id, name, head_revision_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(layoutId, input.layout.boardId, input.name, revisionId, now, now);
    db.query("INSERT INTO revisions (id, layout_id, parent_id, document, origin, summary, created_at) VALUES (?, ?, NULL, ?, 'import', ?, ?)").run(
      revisionId, layoutId, JSON.stringify(input.layout), input.summary, now,
    );
  }).immediate();
  return { layout: { id: layoutId }, revision: { id: revisionId } };
}
