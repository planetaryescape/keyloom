// Repositories for layouts and revisions (02). Every document read is parsed with zod; a row
// that fails to parse is a bug and throws (02#conventions).
import type { Database } from "bun:sqlite";
import { type Layout, LayoutSchema } from "../layout/schema.ts";
import { newId } from "./ids.ts";

export type Origin = "import" | "editor" | "agent" | "undo";

export type LayoutRow = {
  id: string;
  boardId: string;
  name: string;
  headRevisionId: string;
  createdAt: number;
  updatedAt: number;
  /** When the config was archived (hidden, restorable), or null. */
  archivedAt: number | null;
  /** The config and revision this one started as a copy of; the source may have been deleted since. */
  copiedFrom: { layoutId: string; revisionId: string } | null;
};

export type RevisionRow = {
  id: string;
  layoutId: string;
  parentId: string | null;
  origin: Origin;
  summary: string;
  createdAt: number;
};

export class NameTakenError extends Error {
  override name = "NameTakenError";
}

type LayoutDb = {
  id: string; board_id: string; name: string; head_revision_id: string; created_at: number; updated_at: number;
  archived_at: number | null; copied_from_layout_id: string | null; copied_from_revision_id: string | null;
};
type RevisionDb = {
  id: string; layout_id: string; parent_id: string | null; origin: Origin; summary: string; created_at: number; document?: string;
};

const toLayout = (r: LayoutDb): LayoutRow => ({
  id: r.id, boardId: r.board_id, name: r.name, headRevisionId: r.head_revision_id, createdAt: r.created_at, updatedAt: r.updated_at,
  archivedAt: r.archived_at,
  copiedFrom: r.copied_from_layout_id !== null && r.copied_from_revision_id !== null ? { layoutId: r.copied_from_layout_id, revisionId: r.copied_from_revision_id } : null,
});
const toRevision = (r: RevisionDb): RevisionRow => ({
  id: r.id, layoutId: r.layout_id, parentId: r.parent_id, origin: r.origin, summary: r.summary, createdAt: r.created_at,
});

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";

/** Creates a layout and its first revision in one transaction. */
export function createLayout(
  db: Database,
  input: { name: string; layout: Layout; summary: string; origin: Origin; now?: number; selectFirst?: boolean; copiedFrom?: { layoutId: string; revisionId: string } },
): { layout: LayoutRow; revision: RevisionRow } {
  const now = input.now ?? Date.now();
  const layoutId = newId("lay");
  const revisionId = newId("rev");
  try {
    db.transaction(() => {
      // layouts.head_revision_id and revisions.layout_id reference each other; check both at commit.
      db.run("PRAGMA defer_foreign_keys = ON");
      db.query(
        "INSERT INTO layouts (id, board_id, name, head_revision_id, created_at, updated_at, copied_from_layout_id, copied_from_revision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(layoutId, input.layout.boardId, input.name, revisionId, now, now, input.copiedFrom?.layoutId ?? null, input.copiedFrom?.revisionId ?? null);
      db.query(
        "INSERT INTO revisions (id, layout_id, parent_id, document, origin, summary, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)",
      ).run(revisionId, layoutId, JSON.stringify(input.layout), input.origin, input.summary, now);
      // A board's first config is the one on its keyboard; later ones wait to be put on (D-300).
      if (input.selectFirst !== false) db.query("INSERT OR IGNORE INTO board_config (board_id, layout_id) VALUES (?, ?)").run(input.layout.boardId, layoutId);
    }).immediate();
  } catch (err) {
    if (isUniqueViolation(err)) throw new NameTakenError(`a layout named "${input.name}" already exists`);
    throw err;
  }
  return {
    layout: {
      id: layoutId, boardId: input.layout.boardId, name: input.name, headRevisionId: revisionId, createdAt: now, updatedAt: now, archivedAt: null, copiedFrom: input.copiedFrom ?? null,
    },
    revision: { id: revisionId, layoutId, parentId: null, origin: input.origin, summary: input.summary, createdAt: now },
  };
}

/** Oldest first; the explicit tiebreak keeps the order stable when two layouts share a millisecond. */
export function listLayoutRows(db: Database): LayoutRow[] {
  return (db.query("SELECT * FROM layouts ORDER BY created_at, id").all() as LayoutDb[]).map(toLayout);
}

/** `ref` is a `lay_` ID or an exact name. An ID wins, so a layout can't hide another by its name. */
export function findLayoutRow(db: Database, ref: string): LayoutRow | undefined {
  const row = (db.query("SELECT * FROM layouts WHERE id = ?").get(ref) ??
    db.query("SELECT * FROM layouts WHERE name = ?").get(ref)) as LayoutDb | null;
  return row ? toLayout(row) : undefined;
}

/** A revision of `layoutId`, with its parsed document. */
export function findRevision(db: Database, layoutId: string, revisionId: string): { revision: RevisionRow; layout: Layout } | undefined {
  const row = db.query("SELECT * FROM revisions WHERE id = ? AND layout_id = ?").get(revisionId, layoutId) as RevisionDb | null;
  if (!row?.document) return undefined;
  return { revision: toRevision(row), layout: LayoutSchema.parse(JSON.parse(row.document)) };
}

/** The revisions from `headId` back to the first, newest first. Revisions are append-only and linear, so the parent links are the order (created_at can tie within a millisecond). */
export function revisionChain(db: Database, layoutId: string, headId: string): RevisionRow[] {
  const rows = db.query("SELECT id, layout_id, parent_id, origin, summary, created_at FROM revisions WHERE layout_id = ?").all(layoutId) as RevisionDb[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chain: RevisionRow[] = [];
  for (let at = byId.get(headId); at; at = at.parent_id === null ? undefined : byId.get(at.parent_id)) chain.push(toRevision(at));
  return chain;
}
