// Repository for change sets (02#database). Ops are parsed with the zod schema on every read; a
// row that fails to parse is a bug and throws.
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { type ChangeOp, ChangeOpSchema } from "../layout/change.ts";
import { newId } from "./ids.ts";

export type ChangeSetStatus = "proposed" | "applied" | "rejected" | "superseded";
export type ChangeSetSource = "editor" | "agent";

const OpsSchema = z.array(ChangeOpSchema);
const TradeoffsSchema = z.object({ gains: z.array(z.string()), costs: z.array(z.string()) });
export type Tradeoffs = z.infer<typeof TradeoffsSchema>;

export type ChangeSetRow = {
  id: string;
  layoutId: string;
  baseRevisionId: string;
  proposalGroup: string | null;
  source: ChangeSetSource;
  ops: ChangeOp[];
  explanation: string;
  tradeoffs: Tradeoffs;
  /** The ValidationResult JSON as stored. src/app parses it; persistence may not import src/validation (01). */
  validation: unknown;
  status: ChangeSetStatus;
  conversationId: string | null;
  createdAt: number;
  decidedAt: number | null;
};

type Db = {
  id: string; layout_id: string; base_revision_id: string; proposal_group: string | null; source: ChangeSetSource;
  ops: string; explanation: string; tradeoffs: string; validation: string; status: ChangeSetStatus;
  conversation_id: string | null; created_at: number; decided_at: number | null;
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
  validation: JSON.parse(r.validation),
  status: r.status,
  conversationId: r.conversation_id,
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
  now?: number;
};

export function insertChangeSet(db: Database, input: InsertChangeSetInput): ChangeSetRow {
  const now = input.now ?? Date.now();
  const id = newId("cs");
  db.query(
    `INSERT INTO change_sets (id, layout_id, base_revision_id, proposal_group, source, ops, explanation, tradeoffs, validation, status, created_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.layoutId, input.baseRevisionId, input.proposalGroup ?? null, input.source, JSON.stringify(input.ops), input.explanation,
    JSON.stringify(input.tradeoffs ?? { gains: [], costs: [] }), JSON.stringify(input.validation), input.status, now, input.status === "applied" ? now : null,
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
