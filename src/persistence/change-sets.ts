// Repository for change sets (02#database). Ops are parsed with the zod schema on every read; a
// row that fails to parse is a bug and throws.
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { type ChangeOp, ChangeOpSchema, DecisionDraftSchema } from "../layout/change.ts";
import { newId } from "./ids.ts";

export type ChangeSetStatus = "proposed" | "applied" | "rejected" | "superseded";
export type ChangeSetSource = "editor" | "agent";

const OpsSchema = z.array(ChangeOpSchema);
const TradeoffsSchema = z.object({
  gains: z.array(z.string()),
  costs: z.array(z.string()),
  supersededDecisionIds: z.array(z.string()).optional(),
});
export type Tradeoffs = z.infer<typeof TradeoffsSchema>;

export function recordSupersededDecisionIds(db: Database, changeSetId: string, touchedIds: readonly string[]): void {
  const cs = findChangeSet(db, changeSetId);
  if (!cs || touchedIds.length === 0) return;
  const tradeoffs = { ...cs.tradeoffs, supersededDecisionIds: [...new Set([...(cs.tradeoffs.supersededDecisionIds ?? []), ...touchedIds])] };
  db.query("UPDATE change_sets SET tradeoffs = ? WHERE id = ?").run(JSON.stringify(tradeoffs), changeSetId);
}

/** The draft plus the messages of BK's it answers, which become the decision's link back to the conversation (08). */
const StoredDraftSchema = DecisionDraftSchema.extend({ sourceMessageIds: z.array(z.string()).default([]) });
export type StoredDraft = z.infer<typeof StoredDraftSchema>;

export type ChangeSetRow = {
  id: string;
  layoutId: string;
  baseRevisionId: string;
  proposalGroup: string | null;
  source: ChangeSetSource;
  ops: ChangeOp[];
  explanation: string;
  tradeoffs: Tradeoffs;
  /** What to remember when this is applied; null for a change set that carries no reason (08). */
  decisionDraft: StoredDraft | null;
  /** The ValidationResult JSON as stored. src/app parses it; persistence may not import src/validation (01). */
  validation: unknown;
  status: ChangeSetStatus;
  conversationId: string | null;
  /** The proposal card's heading; null for editor change sets. */
  title: string | null;
  createdAt: number;
  decidedAt: number | null;
};

type Db = {
  id: string; layout_id: string; base_revision_id: string; proposal_group: string | null; source: ChangeSetSource;
  ops: string; explanation: string; tradeoffs: string; decision_draft: string | null; validation: string; status: ChangeSetStatus;
  conversation_id: string | null; title: string | null; created_at: number; decided_at: number | null;
};

const toRow = (r: Db): ChangeSetRow => ({
  id: r.id,
  layoutId: r.layout_id,
  baseRevisionId: r.base_revision_id,
  proposalGroup: r.proposal_group,
  source: r.source,
  ops: OpsSchema.parse(JSON.parse(r.ops)),
  explanation: r.explanation,
  tradeoffs: TradeoffsSchema.parse(JSON.parse(r.tradeoffs)),
  decisionDraft: r.decision_draft === null ? null : StoredDraftSchema.parse(JSON.parse(r.decision_draft)),
  validation: JSON.parse(r.validation),
  status: r.status,
  conversationId: r.conversation_id,
  title: r.title,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

export type InsertChangeSetInput = {
  layoutId: string;
  baseRevisionId: string;
  source: ChangeSetSource;
  ops: ChangeOp[];
  explanation: string;
  validation: unknown;
  /** `applied` for the editor path, which proposes and applies in one step. */
  status: "proposed" | "applied";
  proposalGroup?: string;
  tradeoffs?: Tradeoffs;
  decisionDraft?: StoredDraft;
  title?: string;
  conversationId?: string;
  now?: number;
};

export function insertChangeSet(db: Database, input: InsertChangeSetInput): ChangeSetRow {
  const now = input.now ?? Date.now();
  const id = newId("cs");
  db.query(
    `INSERT INTO change_sets (id, layout_id, base_revision_id, proposal_group, source, ops, explanation, tradeoffs, decision_draft, validation, status, conversation_id, title, created_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.layoutId, input.baseRevisionId, input.proposalGroup ?? null, input.source, JSON.stringify(input.ops), input.explanation,
    JSON.stringify(input.tradeoffs ?? { gains: [], costs: [] }), input.decisionDraft ? JSON.stringify(input.decisionDraft) : null, JSON.stringify(input.validation), input.status, input.conversationId ?? null, input.title ?? null, now, input.status === "applied" ? now : null,
  );
  return findChangeSet(db, id) as ChangeSetRow;
}

export function findChangeSet(db: Database, id: string): ChangeSetRow | undefined {
  const row = db.query("SELECT * FROM change_sets WHERE id = ?").get(id) as Db | null;
  return row ? toRow(row) : undefined;
}

/** Newest first, with the ID as the tiebreak for two created in one millisecond. */
export function listChangeSets(db: Database, layoutId: string, opts: { status?: ChangeSetStatus } = {}): ChangeSetRow[] {
  const rows = opts.status
    ? db.query("SELECT * FROM change_sets WHERE layout_id = ? AND status = ? ORDER BY created_at DESC, id DESC").all(layoutId, opts.status)
    : db.query("SELECT * FROM change_sets WHERE layout_id = ? ORDER BY created_at DESC, id DESC").all(layoutId);
  return (rows as Db[]).map(toRow);
}

/** Oldest first. The conversation's proposals, for the chat panel's cards. */
export function listConversationChangeSets(db: Database, conversationId: string): ChangeSetRow[] {
  const rows = db.query("SELECT * FROM change_sets WHERE conversation_id = ? ORDER BY created_at ASC, id ASC").all(conversationId);
  return (rows as Db[]).map(toRow);
}

/** Marks a proposed change set applied, keeping the validation it was applied under, and supersedes the rest of its proposal group. */
export function markApplied(db: Database, cs: ChangeSetRow, validation: unknown, now = Date.now()): void {
  db.query("UPDATE change_sets SET status = 'applied', validation = ?, decided_at = ? WHERE id = ?").run(JSON.stringify(validation), now, cs.id);
  if (cs.proposalGroup !== null) {
    db.query("UPDATE change_sets SET status = 'superseded', decided_at = ? WHERE proposal_group = ? AND id != ? AND status = 'proposed'").run(now, cs.proposalGroup, cs.id);
  }
}

export function markRejected(db: Database, id: string, now = Date.now()): void {
  db.query("UPDATE change_sets SET status = 'rejected', decided_at = ? WHERE id = ?").run(now, id);
}
