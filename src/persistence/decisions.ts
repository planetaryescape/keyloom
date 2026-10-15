// Repository for decisions (08). Only kind `priority` is written so far; the row type already
// carries what a `choice` needs so rung 6 adds writers, not a second shape.
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { SlotSchema } from "../layout/change.ts";
import { newId } from "./ids.ts";

export const PRIORITY_KINDS = ["pinned", "rarely_used", "frequent", "willing_to_relearn"] as const;
export type PriorityKind = (typeof PRIORITY_KINDS)[number];

export const DECISION_STATUSES = ["hypothesis", "tried_helpful", "tried_unhelpful", "superseded", "retired"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** A reason can be about a place ("this thumb key") or a thing ("Command–Shift"), so both are held (08). */
export const SubjectSchema = z.object({
  slots: z.array(SlotSchema).optional(),
  functions: z.array(z.string().min(1)).optional(),
});
export type Subject = z.infer<typeof SubjectSchema>;

const ScopeSchema = z.object({ apps: z.array(z.string()), habits: z.array(z.string()) });
export type Scope = z.infer<typeof ScopeSchema>;
const IdsSchema = z.array(z.string());

export type DecisionRow = {
  id: string;
  layoutId: string;
  kind: "choice" | "priority";
  priorityKind: PriorityKind | null;
  subject: Subject;
  goal: string;
  choice: string;
  reason: string;
  scope: Scope;
  status: DecisionStatus;
  outcomeNote: string | null;
  changeSetId: string | null;
  conversationId: string | null;
  sourceMessageIds: string[];
  supersededBy: string | null;
  createdAt: number;
  updatedAt: number;
};

type Db = {
  id: string; layout_id: string; kind: DecisionRow["kind"]; priority_kind: PriorityKind | null; subject: string; goal: string; choice: string;
  reason: string; scope: string; status: DecisionStatus; outcome_note: string | null; change_set_id: string | null; conversation_id: string | null;
  source_message_ids: string; superseded_by: string | null; created_at: number; updated_at: number;
};

const toRow = (r: Db): DecisionRow => ({
  id: r.id,
  layoutId: r.layout_id,
  kind: r.kind,
  priorityKind: r.priority_kind,
  subject: SubjectSchema.parse(JSON.parse(r.subject)),
  goal: r.goal,
  choice: r.choice,
  reason: r.reason,
  scope: ScopeSchema.parse(JSON.parse(r.scope)),
  status: r.status,
  outcomeNote: r.outcome_note,
  changeSetId: r.change_set_id,
  conversationId: r.conversation_id,
  sourceMessageIds: IdsSchema.parse(JSON.parse(r.source_message_ids)),
  supersededBy: r.superseded_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type InsertPriorityInput = {
  layoutId: string;
  priorityKind: PriorityKind;
  subject: Subject;
  /** BK's statement as he said it. */
  goal: string;
  /** The priority kind in words. */
  choice: string;
  reason: string;
  conversationId?: string;
  sourceMessageIds?: string[];
  now?: number;
};

export function insertPriority(db: Database, input: InsertPriorityInput): DecisionRow {
  const id = newId("dec");
  const now = input.now ?? Date.now();
  // A priority is never "tried", so it keeps the schema's initial status until it is retired.
  db.query(
    `INSERT INTO decisions (id, layout_id, kind, priority_kind, subject, goal, choice, reason, scope, status, conversation_id, source_message_ids, created_at, updated_at)
     VALUES (?, ?, 'priority', ?, ?, ?, ?, ?, ?, 'hypothesis', ?, ?, ?, ?)`,
  ).run(
    id, input.layoutId, input.priorityKind, JSON.stringify(input.subject), input.goal, input.choice, input.reason,
    JSON.stringify({ apps: [], habits: [] } satisfies Scope), input.conversationId ?? null, JSON.stringify(input.sourceMessageIds ?? []), now, now,
  );
  return findDecision(db, id) as DecisionRow;
}

export function findDecision(db: Database, id: string): DecisionRow | undefined {
  const row = db.query("SELECT * FROM decisions WHERE id = ?").get(id) as Db | null;
  return row ? toRow(row) : undefined;
}

/** Newest first; the ID breaks a tie between two written in one millisecond. */
export function listDecisions(
  db: Database,
  layoutId: string,
  opts: { kind?: DecisionRow["kind"]; status?: DecisionStatus; active?: boolean } = {},
): DecisionRow[] {
  const where = ["layout_id = ?"];
  const args: (string | number)[] = [layoutId];
  if (opts.kind) {
    where.push("kind = ?");
    args.push(opts.kind);
  }
  if (opts.status) {
    where.push("status = ?");
    args.push(opts.status);
  }
  // Retired and superseded decisions are out of the agent's context (08).
  if (opts.active) where.push("status NOT IN ('retired','superseded')");
  const rows = db.query(`SELECT * FROM decisions WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC`).all(...args);
  return (rows as Db[]).map(toRow);
}

export function updateDecision(
  db: Database,
  id: string,
  fields: { goal?: string; choice?: string; reason?: string; status?: DecisionStatus },
  now = Date.now(),
): void {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(value);
  }
  if (sets.length === 0) return;
  db.query(`UPDATE decisions SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...args, now, id);
}

/** Oldest first. The priorities BK stated in one conversation that still stand, for its chips. */
export function listConversationPriorities(db: Database, conversationId: string): DecisionRow[] {
  const rows = db
    .query("SELECT * FROM decisions WHERE conversation_id = ? AND kind = 'priority' AND status NOT IN ('retired','superseded') ORDER BY created_at ASC, id ASC")
    .all(conversationId);
  return (rows as Db[]).map(toRow);
}
