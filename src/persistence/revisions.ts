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

/**
 * The change sets whose effect `revisionId`'s document carries. A change or editor revision adds
 * its change set; an undo revision copies the document before the revision it undid, so it carries
 * what that earlier revision did. That makes undo and redo the same operation here, which is what
 * lets decision memory follow either (08).
 */
export function liveChangeSets(db: Database, layoutId: string, revisionId: string): Set<string> {
  type Row = { id: string; parent_id: string | null; origin: Origin; change_set_id: string | null; undoes_revision_id: string | null };
  const rows = db.query("SELECT id, parent_id, origin, change_set_id, undoes_revision_id FROM revisions WHERE layout_id = ?").all(layoutId) as Row[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chain: Row[] = [];
  for (let at = byId.get(revisionId); at; at = at.parent_id === null ? undefined : byId.get(at.parent_id)) chain.unshift(at);
  const live = new Map<string, Set<string>>();
  for (const r of chain) {
    let set: Set<string>;
    if (r.origin === "undo") {
      const undone = r.undoes_revision_id === null ? undefined : byId.get(r.undoes_revision_id);
      const restored = undone?.parent_id ?? null;
      set = new Set(restored === null ? [] : (live.get(restored) ?? []));
    } else {
      set = new Set(r.parent_id === null ? [] : (live.get(r.parent_id) ?? []));
      if (r.change_set_id !== null) set.add(r.change_set_id);
    }
    live.set(r.id, set);
  }
  return new Set(live.get(revisionId) ?? []);
}
