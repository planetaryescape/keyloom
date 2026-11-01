// Repository for board reviews (D-340): what keyloom found in one revision of a config, and which findings BK hid. A review is written
// once with the checks' items, then the agent's part fills in; the items are never edited, only replaced as a set per source.
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { newId } from "./ids.ts";
import { BehaviorEvidenceSchema, type BehaviorEvidence } from "../layout/review-evidence.ts";

export type ReviewTrigger = "connect" | "apply" | "import" | "manual";
export type AiStatus = "pending" | "running" | "done" | "unavailable" | "failed";
export const REVIEW_AI_STALE_MS = 10 * 60_000;
export const REVIEW_CONTRACT_VERSION = 1;

export type ReviewItemRow = {
  id: string;
  source: "check" | "agent";
  kind: "problem" | "hint" | "suggestion";
  severity: "error" | "warning" | "info";
  code: string;
  title: string;
  body: string;
  keys: Array<{ layerId: string; position: number }>;
  layers: string[];
  proposalId: string | null;
  fixes: string[];
};

export type BoardReviewRow = {
  id: string;
  layoutId: string;
  revisionId: string;
  trigger: ReviewTrigger;
  checkedAt: number;
  summary: { layers: number; keys: number; combos: number };
  ai: { status: AiStatus; reason: string | null; model: string | null; startedAt: number | null };
  previousReviewId: string | null;
  /** The previous review's items that this revision no longer produces, as they were. */
  fixed: ReviewItemRow[];
  contractVersion: number;
  snapshotKey: string | null;
  invalidatedReason: string | null;
  runId: string | null;
};

type ReviewDb = {
  id: string; layout_id: string; revision_id: string; trigger: ReviewTrigger; checked_at: number; summary: string;
  ai_status: AiStatus; ai_reason: string | null; ai_model: string | null; ai_started_at: number | null; previous_review_id: string | null; fixed: string;
  contract_version: number; snapshot_key: string | null; invalidated_reason: string | null; ai_run_id: string | null;
};
type ItemDb = {
  id: string; source: ReviewItemRow["source"]; kind: ReviewItemRow["kind"]; severity: ReviewItemRow["severity"]; code: string; title: string; body: string;
  keys: string; layers: string; proposal_id: string | null; fixes: string;
};

const KeysSchema = z.array(z.object({ layerId: z.string(), position: z.number().int() }));
const StringsSchema = z.array(z.string());
const SummarySchema = z.object({ layers: z.number(), keys: z.number(), combos: z.number() });
const ItemRowSchema = z.object({
  id: z.string(), source: z.enum(["check", "agent"]), kind: z.enum(["problem", "hint", "suggestion"]), severity: z.enum(["error", "warning", "info"]), code: z.string(),
  title: z.string(), body: z.string(), keys: KeysSchema, layers: StringsSchema, proposalId: z.string().nullable(), fixes: StringsSchema,
});

const toReview = (r: ReviewDb): BoardReviewRow => ({
  id: r.id, layoutId: r.layout_id, revisionId: r.revision_id, trigger: r.trigger, checkedAt: r.checked_at, summary: SummarySchema.parse(JSON.parse(r.summary)),
  ai: { status: r.ai_status, reason: r.ai_reason, model: r.ai_model, startedAt: r.ai_started_at },
  previousReviewId: r.previous_review_id, fixed: z.array(ItemRowSchema).parse(JSON.parse(r.fixed)),
  contractVersion: r.contract_version, snapshotKey: r.snapshot_key, invalidatedReason: r.invalidated_reason, runId: r.ai_run_id,
});

const toItem = (r: ItemDb): ReviewItemRow => ({
  id: r.id, source: r.source, kind: r.kind, severity: r.severity, code: r.code, title: r.title, body: r.body,
  keys: KeysSchema.parse(JSON.parse(r.keys)), layers: StringsSchema.parse(JSON.parse(r.layers)), proposalId: r.proposal_id, fixes: StringsSchema.parse(JSON.parse(r.fixes)),
});

export const findReviewOfRevision = (db: Database, layoutId: string, revisionId: string): BoardReviewRow | undefined => {
  const row = db.query("SELECT * FROM board_reviews WHERE layout_id = ? AND revision_id = ?").get(layoutId, revisionId) as ReviewDb | null;
  return row ? toReview(row) : undefined;
};

export const findReview = (db: Database, id: string): BoardReviewRow | undefined => {
  const row = db.query("SELECT * FROM board_reviews WHERE id = ?").get(id) as ReviewDb | null;
  return row ? toReview(row) : undefined;
};

/** The newest review of the config, whatever revision it was of. Ties break on the ID, which sorts in creation order. */
export const latestReview = (db: Database, layoutId: string): BoardReviewRow | undefined => {
  const row = db.query("SELECT * FROM board_reviews WHERE layout_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1").get(layoutId) as ReviewDb | null;
  return row ? toReview(row) : undefined;
};

export function listReviewItems(db: Database, reviewId: string): ReviewItemRow[] {
  return (db.query("SELECT * FROM review_items WHERE review_id = ? ORDER BY position").all(reviewId) as ItemDb[]).map(toItem);
}

const insertItems = (db: Database, reviewId: string, items: readonly ReviewItemRow[], from: number): void => {
  const insert = db.query(
    "INSERT OR IGNORE INTO review_items (review_id, id, position, source, kind, severity, code, title, body, keys, layers, proposal_id, fixes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const [i, it] of items.entries()) {
    insert.run(reviewId, it.id, from + i, it.source, it.kind, it.severity, it.code, it.title, it.body, JSON.stringify(it.keys), JSON.stringify(it.layers), it.proposalId, JSON.stringify(it.fixes));
  }
};

export type InsertReview = {
  layoutId: string; revisionId: string; trigger: ReviewTrigger; checkedAt: number; summary: BoardReviewRow["summary"];
  items: ReviewItemRow[]; previousReviewId: string | null; fixed: ReviewItemRow[];
  snapshotKey?: string;
};

/** The review of a revision, or the one already there: two writers racing for the same revision both get the same row. Call it inside `transact`. */
export function insertReview(db: Database, input: InsertReview): { review: BoardReviewRow; created: boolean } {
  const existing = findReviewOfRevision(db, input.layoutId, input.revisionId);
  if (existing) return { review: existing, created: false };
  const id = newId("rvw");
  db.query(
    "INSERT INTO board_reviews (id, layout_id, revision_id, trigger, checked_at, summary, ai_status, previous_review_id, fixed) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
  ).run(id, input.layoutId, input.revisionId, input.trigger, input.checkedAt, JSON.stringify(input.summary), input.previousReviewId, JSON.stringify(input.fixed));
  insertItems(db, id, input.items, 0);
  if (input.snapshotKey) db.query("UPDATE board_reviews SET contract_version = ?, snapshot_key = ? WHERE id = ?").run(REVIEW_CONTRACT_VERSION, input.snapshotKey, id);
  return { review: findReview(db, id) as BoardReviewRow, created: true };
}

/**
 * Takes the agent's part of a review for one run. False when another run holds it, or it is already done; a run that started over
 * `staleMs` ago is taken to have died with its process.
 */
export function claimAi(db: Database, reviewId: string, now: number, staleMs: number, opts: { force?: boolean } = {}): boolean {
  const retry = opts.force ? "'pending', 'unavailable', 'failed', 'done'" : "'pending', 'unavailable', 'failed'";
  return db.query(
    `UPDATE board_reviews SET ai_status = 'running', ai_reason = NULL, ai_started_at = ?, ai_run_id = ?
     WHERE id = ? AND (ai_status IN (${retry}) OR (ai_status = 'running' AND ai_started_at < ?))`,
  ).run(now, newId("run"), reviewId, now - staleMs).changes > 0;
}

export const ownsReviewRun = (db: Database, row: BoardReviewRow): boolean => {
  const saved = findReview(db, row.id);
  return row.runId !== null && saved?.runId === row.runId && saved.ai.status === "running" && saved.invalidatedReason === null;
};

/** Withdraw both published and not-yet-published proposals and revoke the writer's lease immediately. */
export function invalidateReview(db: Database, reviewId: string, reason: string): void {
  db.query(`UPDATE change_sets SET status = 'rejected', decided_at = ? WHERE status = 'proposed' AND id IN
    (SELECT change_set_id FROM review_proposals WHERE review_id = ? UNION SELECT proposal_id FROM review_items WHERE review_id = ? AND source = 'agent')`).run(Date.now(), reviewId, reviewId);
  clearReviewAgentItems(db, reviewId);
  db.query("UPDATE board_reviews SET ai_status = 'failed', ai_reason = ?, invalidated_reason = ?, ai_run_id = NULL WHERE id = ?").run(reason, reason, reviewId);
}

export function resetReview(db: Database, row: BoardReviewRow, input: { snapshotKey: string; trigger: ReviewTrigger; checkedAt: number; summary: BoardReviewRow["summary"]; items: ReviewItemRow[] }): BoardReviewRow {
  invalidateReview(db, row.id, "Review inputs changed.");
  db.query("DELETE FROM review_items WHERE review_id = ?").run(row.id);
  insertItems(db, row.id, input.items, 0);
  db.query(`UPDATE board_reviews SET contract_version = ?, snapshot_key = ?, invalidated_reason = NULL,
    trigger = ?, checked_at = ?, summary = ?, ai_status = 'pending', ai_reason = NULL, ai_model = NULL, ai_started_at = NULL WHERE id = ?`)
    .run(REVIEW_CONTRACT_VERSION, input.snapshotKey, input.trigger, input.checkedAt, JSON.stringify(input.summary), row.id);
  return findReview(db, row.id)!;
}

export function linkReviewProposal(db: Database, row: BoardReviewRow, changeSetId: string): void {
  if (!ownsReviewRun(db, row)) throw new Error("The review run was superseded.");
  db.query("INSERT INTO review_proposals (change_set_id, review_id, run_id) VALUES (?, ?, ?)").run(changeSetId, row.id, row.runId);
}

export function proposalReview(db: Database, id: string): { review: BoardReviewRow; runId: string } | undefined {
  const link = db.query("SELECT review_id, run_id FROM review_proposals WHERE change_set_id = ?").get(id) as { review_id: string; run_id: string } | null;
  const review = link && findReview(db, link.review_id);
  return review ? { review, runId: link!.run_id } : undefined;
}

export function saveReviewBehavior(db: Database, row: BoardReviewRow, proposalId: string, evidence: BehaviorEvidence): void {
  if (!ownsReviewRun(db, row)) return;
  db.query("UPDATE review_proposals SET behavior_evidence = ? WHERE change_set_id = ? AND review_id = ? AND run_id = ?")
    .run(JSON.stringify(evidence), proposalId, row.id, row.runId);
}

export function reviewBehavior(db: Database, row: BoardReviewRow): Array<BehaviorEvidence & { proposalId: string }> {
  const rows = db.query("SELECT change_set_id, behavior_evidence FROM review_proposals WHERE review_id = ? AND run_id = ? AND behavior_evidence IS NOT NULL").all(row.id, row.runId) as Array<{ change_set_id: string; behavior_evidence: string }>;
  return rows.map((r) => ({ proposalId: r.change_set_id, ...BehaviorEvidenceSchema.parse(JSON.parse(r.behavior_evidence)) }));
}

/** Ends a run that claimed the review. `items` replace whatever the agent found before; the checks' items stay. */
export function finishAi(
  db: Database, reviewId: string,
  outcome: { status: "done" | "unavailable" | "failed"; reason: string | null; model: string | null; items: ReviewItemRow[]; fixedAgent: ReviewItemRow[] },
): void {
  db.query("DELETE FROM review_items WHERE review_id = ? AND source = 'agent'").run(reviewId);
  // `fixed` holds the checks' finds from when the review was made; the agent's join them now that it has looked.
  const kept = (findReview(db, reviewId)?.fixed ?? []).filter((f) => f.source === "check");
  db.query("UPDATE board_reviews SET fixed = ? WHERE id = ?").run(JSON.stringify([...kept, ...outcome.fixedAgent]), reviewId);
  const next = (db.query("SELECT COALESCE(MAX(position) + 1, 0) AS n FROM review_items WHERE review_id = ?").get(reviewId) as { n: number }).n;
  insertItems(db, reviewId, outcome.items, next);
  db.query("UPDATE board_reviews SET ai_status = ?, ai_reason = ?, ai_model = ? WHERE id = ?").run(outcome.status, outcome.reason, outcome.model, reviewId);
}

/** A forced look replaces old suggestions immediately, before another measurement could be read beside them. */
export function clearReviewAgentItems(db: Database, reviewId: string): void {
  db.query("DELETE FROM review_items WHERE review_id = ? AND source = 'agent'").run(reviewId);
}

/** At start-up: a review left `running` by a process that is gone is failed, so its screen stops waiting. */
export function failOrphanedRuns(db: Database, reason: string): number {
  return db.query("UPDATE board_reviews SET ai_status = 'failed', ai_reason = ? WHERE ai_status = 'running'").run(reason).changes;
}

export function dismissals(db: Database, layoutId: string): Map<string, number> {
  const rows = db.query("SELECT item_id, dismissed_at FROM review_dismissals WHERE layout_id = ?").all(layoutId) as Array<{ item_id: string; dismissed_at: number }>;
  return new Map(rows.map((r) => [r.item_id, r.dismissed_at]));
}

/** Hides a finding on this config. Hiding it again keeps the first time. */
export function dismissItem(db: Database, layoutId: string, itemId: string, at: number): void {
  db.query("INSERT OR IGNORE INTO review_dismissals (layout_id, item_id, dismissed_at) VALUES (?, ?, ?)").run(layoutId, itemId, at);
}

export function restoreItem(db: Database, layoutId: string, itemId: string): void {
  db.query("DELETE FROM review_dismissals WHERE layout_id = ? AND item_id = ?").run(layoutId, itemId);
}
