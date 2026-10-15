// Choice decisions: what keyloom remembers about a change it made and why (08). The lifecycle lives
// here so every path that writes one (apply, undo, outcome) agrees on it:
//
//   hypothesis ──BK says it helped──▶ tried_helpful
//       │ ──────BK says it did not──▶ tried_unhelpful
//       └─ a later change touches its keys ──▶ superseded (by the decision that change wrote, if any)
//   any active status ──BK retires it──▶ retired
//
// Undoing the change that wrote a decision retires it, and undoing the one that superseded it puts
// it back with the status it had. A redo does the reverse. BK's own retirement is never reversed.
import type { Database } from "bun:sqlite";
import type { DecisionDraft, Slot } from "../layout/change.ts";
import { bindingFunctions } from "../layout/functions.ts";
import type { Layout } from "../layout/schema.ts";
import {
  type DecisionRow, type DecisionStatus, type Subject, findDecision, insertChoice, listDecisions, listDecisionsOfChangeSet, listDecisionsSupersededBy,
  updateDecision,
} from "../persistence/decisions.ts";
import { successfulFlashes } from "../persistence/builds.ts";

const ACTIVE: readonly DecisionStatus[] = ["hypothesis", "tried_helpful", "tried_unhelpful"];
const isActive = (d: DecisionRow) => ACTIVE.includes(d.status);

/** The keys a change affected, and the functions now on them: the decision's subject, from the validator's diff (08). */
export function subjectOf(after: Layout, slots: readonly Slot[]): Subject {
  const functions = new Set<string>();
  for (const slot of slots) {
    const binding = after.layers.find((l) => l.id === slot.layerId)?.bindings[slot.position];
    if (binding) for (const fn of bindingFunctions(binding)) functions.add(fn);
  }
  return { slots: [...slots], functions: [...functions] };
}

function supersede(db: Database, d: DecisionRow, by: string | null, now: number): void {
  if (!isActive(d)) return;
  updateDecision(db, d.id, { status: "superseded", statusBefore: d.status, supersededBy: by }, now);
}

export type RecordChoiceInput = {
  layoutId: string;
  draft: DecisionDraft;
  subject: Subject;
  changeSetId: string;
  conversationId: string | null;
  sourceMessageIds: string[];
  /** Active decisions the change touched; they are superseded by the new one. */
  touched: readonly string[];
  now?: number;
};

/** Writes the decision for an applied change set and supersedes what it overrode. */
export function recordChoice(db: Database, input: RecordChoiceInput): DecisionRow {
  const now = input.now ?? Date.now();
  const decision = insertChoice(db, {
    layoutId: input.layoutId, subject: input.subject, goal: input.draft.goal, choice: input.draft.choice, reason: input.draft.reason, scope: input.draft.scope,
    changeSetId: input.changeSetId, conversationId: input.conversationId, sourceMessageIds: input.sourceMessageIds, now,
  });
  supersedeTouched(db, input.touched, decision.id, now);
  return decision;
}

/**
 * A change applied with nothing to remember still overrode what it touched. Those decisions are
 * superseded with no successor, so the memory does not keep claiming a key is where it no longer is.
 */
export function supersedeTouched(db: Database, touched: readonly string[], by: string | null, now = Date.now()): void {
  for (const id of touched) {
    const d = findDecision(db, id);
    if (d && d.kind === "choice") supersede(db, d, by, now);
  }
}

/** The undo of the revision that applied `changeSetId`: its decisions leave the memory, and what it superseded returns. */
export function suspendChangeSet(db: Database, changeSetId: string, now = Date.now()): void {
  for (const own of listDecisionsOfChangeSet(db, changeSetId)) {
    for (const older of listDecisionsSupersededBy(db, own.id)) {
      if (older.status === "superseded") updateDecision(db, older.id, { status: older.statusBefore ?? "hypothesis", statusBefore: null }, now);
    }
    if (isActive(own)) updateDecision(db, own.id, { status: "retired", statusBefore: own.status }, now);
  }
}

/** Putting a change back (an undo of an undo): the reverse of `suspendChangeSet`. */
export function restoreChangeSet(db: Database, changeSetId: string, now = Date.now()): void {
  for (const own of listDecisionsOfChangeSet(db, changeSetId)) {
    // Retired by an undo, not by BK: only those carry a status to return to.
    if (own.status !== "retired" || own.statusBefore === null) continue;
    updateDecision(db, own.id, { status: own.statusBefore, statusBefore: null }, now);
    for (const older of listDecisionsSupersededBy(db, own.id)) supersede(db, older, own.id, now);
  }
}

export type OutcomeStatus = "tried_helpful" | "tried_unhelpful";

export class OutcomeError extends Error {
  override name = "OutcomeError";
}

/** BK's verdict on a choice after living with it (D-018). The note is his reason, which later changes quote back. */
export function recordOutcome(db: Database, id: string, outcome: { status: OutcomeStatus; note: string }, now = Date.now()): DecisionRow {
  const d = findDecision(db, id);
  if (!d) throw new OutcomeError(`no decision "${id}"`);
  if (d.kind !== "choice") throw new OutcomeError(`${id} is a priority, which BK states and removes; an outcome applies to a choice`);
  if (!isActive(d)) throw new OutcomeError(`${id} is ${d.status}, so it no longer applies and has no outcome to record`);
  const note = outcome.note.trim();
  if (!note) throw new OutcomeError("an outcome needs BK's own words as the note");
  // Answering the question is also asking it: a verdict given unprompted must not be asked about again.
  updateDecision(db, id, { status: outcome.status, outcomeNote: note, outcomeAskedAt: d.outcomeAskedAt ?? now }, now);
  return findDecision(db, id) as DecisionRow;
}

/** Q6 (assumed): ask once, a week after the flash that first carried the decision. */
export const OUTCOME_QUESTION_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export type OutcomeQuestion = { decision: DecisionRow; flashedAt: number };

/**
 * The hypothesis decisions BK has had on his keyboard for at least a week and has not been asked
 * about. A decision counts from the first successful flash whose build began after it was applied,
 * so a later retuning flash does not push a month-old decision back to "too soon". `now` is injected
 * so the rule is testable without waiting a week.
 */
export function dueOutcomeQuestions(db: Database, layoutId: string, now: number): OutcomeQuestion[] {
  const flashes = successfulFlashes(db, layoutId);
  const due: OutcomeQuestion[] = [];
  for (const decision of listDecisions(db, layoutId, { kind: "choice", status: "hypothesis" })) {
    if (decision.outcomeAskedAt !== null) continue;
    const first = flashes.find((f) => f.buildStartedAt >= decision.createdAt);
    if (first && now - first.flashedAt >= OUTCOME_QUESTION_DELAY_MS) due.push({ decision, flashedAt: first.flashedAt });
  }
  // Oldest flash first, so the longest-lived decision is asked about first.
  return due.sort((a, b) => a.flashedAt - b.flashedAt || a.decision.createdAt - b.decision.createdAt);
}

/** BK dismissed the question without a verdict: it is not asked again, and the decision stays a hypothesis. */
export function dismissOutcomeQuestion(db: Database, id: string, now = Date.now()): DecisionRow {
  const d = findDecision(db, id);
  if (!d) throw new OutcomeError(`no decision "${id}"`);
  updateDecision(db, id, { outcomeAskedAt: now }, now);
  return findDecision(db, id) as DecisionRow;
}
