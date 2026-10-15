// Appending revisions (02#applying-undoing-and-stale-bases). History is append-only: a change
// or an undo is a new revision whose parent is the head, and the head pointer moves with it.
import type { Database } from "bun:sqlite";
import type { Layout } from "../layout/schema.ts";
import { newId } from "./ids.ts";
import type { Origin, RevisionRow } from "./layouts.ts";

/** The head was not the revision the caller expected; nothing was written. */
export class HeadMovedError extends Error {
  override name = "HeadMovedError";
  constructor(readonly expected: string, readonly actual: string) {
    super(`the head is ${actual}, not ${expected}`);
  }
}

export type AppendRevisionInput = {
  layoutId: string;
  /** The head the caller decided against. */
  expectedHeadId: string;
  layout: Layout;
  origin: Exclude<Origin, "import">;
  summary: string;
  changeSetId?: string;
  undoesRevisionId?: string;
  now?: number;
};

/** Writes a revision with `parent_id = head` and moves the head to it. Call it inside `transact`, with the check and the write together. */
export function appendRevision(db: Database, input: AppendRevisionInput): RevisionRow {
  const now = input.now ?? Date.now();
  const head = db.query("SELECT head_revision_id FROM layouts WHERE id = ?").get(input.layoutId) as { head_revision_id: string } | null;
  if (!head) throw new Error(`no layout ${input.layoutId}`);
  if (head.head_revision_id !== input.expectedHeadId) throw new HeadMovedError(input.expectedHeadId, head.head_revision_id);
  const id = newId("rev");
  db.query(
    `INSERT INTO revisions (id, layout_id, parent_id, document, origin, change_set_id, undoes_revision_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.layoutId, input.expectedHeadId, JSON.stringify(input.layout), input.origin, input.changeSetId ?? null, input.undoesRevisionId ?? null, input.summary, now);
  db.query("UPDATE layouts SET head_revision_id = ?, updated_at = ? WHERE id = ?").run(id, now, input.layoutId);
  return { id, layoutId: input.layoutId, parentId: input.expectedHeadId, origin: input.origin, summary: input.summary, createdAt: now };
}
