// Repository for decisions (08): priorities BK states and choices made when a change is applied.
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
  /** Set only while the status is `superseded`; null when it was overridden without a recorded successor. */
  supersededBy: string | null;
  /** The status to put back if the change that took this out of play is reversed (migration 0006). */
  statusBefore: DecisionStatus | null;
  /** When BK answered or dismissed the "has this worked out?" question (Q6). */
  outcomeAskedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type Db = {
  id: string; layout_id: string; kind: DecisionRow["kind"]; priority_kind: PriorityKind | null; subject: string; goal: string; choice: string;
  reason: string; scope: string; status: DecisionStatus; outcome_note: string | null; change_set_id: string | null; conversation_id: string | null;
  source_message_ids: string; superseded_by: string | null; status_before: DecisionStatus | null; outcome_asked_at: number | null;
  created_at: number; updated_at: number;
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
  // The pointer is kept in the row after a reversal so a redo can re-apply it, but it means nothing unless the status says so.
  supersededBy: r.status === "superseded" ? r.superseded_by : null,
  statusBefore: r.status_before,
  outcomeAskedAt: r.outcome_asked_at,
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

/** Choice decisions are written when a change set is applied (08); `now` is the moment of the apply. */
export type InsertChoiceInput = {
  layoutId: string;
  subject: Subject;
  goal: string;
  choice: string;
  reason: string;
  scope: Scope;
  changeSetId: string;
  conversationId?: string | null;
  sourceMessageIds?: string[];
  now?: number;
};

export function insertChoice(db: Database, input: InsertChoiceInput): DecisionRow {
  const id = newId("dec");
  const now = input.now ?? Date.now();
  db.query(
    `INSERT INTO decisions (id, layout_id, kind, priority_kind, subject, goal, choice, reason, scope, status, change_set_id, conversation_id, source_message_ids, created_at, updated_at)
     VALUES (?, ?, 'choice', NULL, ?, ?, ?, ?, ?, 'hypothesis', ?, ?, ?, ?, ?)`,
  ).run(
    id, input.layoutId, JSON.stringify(input.subject), input.goal, input.choice, input.reason, JSON.stringify(input.scope),
    input.changeSetId, input.conversationId ?? null, JSON.stringify(input.sourceMessageIds ?? []), now, now,
  );
  return findDecision(db, id) as DecisionRow;
}

export type DecisionFields = {
  goal?: string;
  choice?: string;
  reason?: string;
  scope?: Scope;
  status?: DecisionStatus;
  outcomeNote?: string | null;
  supersededBy?: string | null;
  statusBefore?: DecisionStatus | null;
  outcomeAskedAt?: number | null;
};

// A fixed column per field, so a caller's key is never spliced into SQL.
const COLUMNS: Record<keyof DecisionFields, string> = {
  goal: "goal", choice: "choice", reason: "reason", scope: "scope", status: "status", outcomeNote: "outcome_note",
  supersededBy: "superseded_by", statusBefore: "status_before", outcomeAskedAt: "outcome_asked_at",
};

export function updateDecision(db: Database, id: string, fields: DecisionFields, now = Date.now()): void {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [name, value] of Object.entries(fields) as [keyof DecisionFields, unknown][]) {
    if (value === undefined) continue;
    sets.push(`${COLUMNS[name]} = ?`);
    args.push(name === "scope" ? JSON.stringify(value) : (value as string | number | null));
  }
  if (sets.length === 0) return;
  db.query(`UPDATE decisions SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...args, now, id);
}

/** The decisions a change set wrote (at most one today). */
export function listDecisionsOfChangeSet(db: Database, changeSetId: string): DecisionRow[] {
  return (db.query("SELECT * FROM decisions WHERE change_set_id = ? ORDER BY created_at, id").all(changeSetId) as Db[]).map(toRow);
}

/** Decisions that point at `successorId` as the one that replaced them, whatever their status now. */
export function listDecisionsSupersededBy(db: Database, successorId: string): DecisionRow[] {
  return (db.query("SELECT * FROM decisions WHERE superseded_by = ? ORDER BY created_at, id").all(successorId) as Db[]).map(toRow);
}

/** Oldest first. The priorities BK stated in one conversation that still stand, for its chips. */
export function listConversationPriorities(db: Database, conversationId: string): DecisionRow[] {
  const rows = db
    .query("SELECT * FROM decisions WHERE conversation_id = ? AND kind = 'priority' AND status NOT IN ('retired','superseded') ORDER BY created_at ASC, id ASC")
    .all(conversationId);
  return (rows as Db[]).map(toRow);
}
