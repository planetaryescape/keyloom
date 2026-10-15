// Use cases for decision memory (08): priorities BK states, choices written when a change is applied,
// and the outcomes BK reports. They share list, show, edit and retire.
import {
  type OutcomeQuestion, type OutcomeStatus, OutcomeError, dismissOutcomeQuestion, dueOutcomeQuestions, recordOutcome as saveOutcome,
} from "../memory/choices.ts";
import { type RecordPriorityInput, activePriorities, recordPriority as savePriority } from "../memory/priorities.ts";
import {
  type DecisionRow, type DecisionStatus, findDecision, listDecisions as listRows, updateDecision,
} from "../persistence/decisions.ts";
import type { DecisionFact } from "../validation/decision-rules.ts";
import type { PinnedPriority } from "../validation/priority-rules.ts";
import type { App } from "./context.ts";
import { NotFoundError, UsageError } from "./errors.ts";
import { getLayout } from "./layouts.ts";

export type { DecisionRow, DecisionStatus } from "../persistence/decisions.ts";

export function recordPriority(app: App, ref: string, input: Omit<RecordPriorityInput, "layoutId">): { decision: DecisionRow; created: boolean } {
  if (!input.statement.trim()) throw new UsageError("a priority needs BK's statement");
  if ((input.subject.slots?.length ?? 0) === 0 && (input.subject.functions?.length ?? 0) === 0) {
    throw new UsageError("a priority needs at least one key or function it is about");
  }
  return savePriority(app.db, { ...input, layoutId: getLayout(app, ref).layout.id });
}

export function listDecisions(app: App, ref: string, opts: { kind?: DecisionRow["kind"]; status?: DecisionStatus } = {}): DecisionRow[] {
  return listRows(app.db, getLayout(app, ref).layout.id, opts);
}

export function showDecision(app: App, id: string): DecisionRow {
  const row = findDecision(app.db, id);
  if (!row) throw new NotFoundError(`no decision "${id}"`);
  return row;
}

/** Takes it out of the agent's context and the validator's checks, and keeps the row so the history of why survives (08). */
export function retireDecision(app: App, id: string): DecisionRow {
  showDecision(app, id);
  updateDecision(app.db, id, { status: "retired" });
  return showDecision(app, id);
}

export type DecisionEdit = {
  goal?: string | undefined; choice?: string | undefined; reason?: string | undefined; scope?: { apps: string[]; habits: string[] } | undefined;
  status?: DecisionStatus | undefined; outcomeNote?: string | null | undefined;
};

export function editDecision(app: App, id: string, fields: DecisionEdit): DecisionRow {
  const row = showDecision(app, id);
  for (const name of ["goal", "choice", "reason"] as const) {
    const value = fields[name];
    if (value !== undefined && !value.trim()) throw new UsageError(`the ${name} must not be empty`);
  }
  // Moving a decision back to a hypothesis, or on to a verdict, is BK's call; what he last said about it stays unless he changes it.
  updateDecision(app.db, id, { ...fields, ...(fields.status !== undefined && fields.status !== row.status ? { statusBefore: null } : {}) });
  return showDecision(app, id);
}

/** Retires a priority from its chip. Anything else is not removable from the chat, so a stray ID can't retire a choice. */
export function retirePriority(app: App, id: string): DecisionRow {
  const row = showDecision(app, id);
  if (row.kind !== "priority") throw new UsageError(`${id} is a ${row.kind} decision, not a priority`);
  return retireDecision(app, id);
}

/** The active priorities for a layout, newest first. */
export const layoutPriorities = (app: App, layoutId: string): DecisionRow[] => activePriorities(app.db, layoutId);

/** Pinned priorities in the shape the validator takes. */
export function pinnedFor(app: App, layoutId: string): PinnedPriority[] {
  return activePriorities(app.db, layoutId)
    .filter((d) => d.priorityKind === "pinned")
    .map((d) => ({ decisionId: d.id, statement: d.goal, slots: d.subject.slots ?? [], functions: d.subject.functions ?? [] }));
}

/** Active choice decisions in the shape the validator takes. */
export function decisionFactsFor(app: App, layoutId: string): DecisionFact[] {
  return listRows(app.db, layoutId, { kind: "choice", active: true }).map((d) => ({
    decisionId: d.id, goal: d.goal, choice: d.choice, reason: d.reason,
    status: d.status as DecisionFact["status"], slots: d.subject.slots ?? [], functions: d.subject.functions ?? [],
  }));
}

/** The active choices for a layout, newest first: what the agent is shown beside the priorities. */
export const layoutChoices = (app: App, layoutId: string): DecisionRow[] => listRows(app.db, layoutId, { kind: "choice", active: true });

/** BK's verdict on a choice, in his words. Refuses a priority, and a decision that no longer applies. */
export function recordOutcome(app: App, id: string, outcome: { status: OutcomeStatus; note: string }): DecisionRow {
  showDecision(app, id);
  try {
    return saveOutcome(app.db, id, outcome);
  } catch (err) {
    if (err instanceof OutcomeError) throw new UsageError(err.message);
    throw err;
  }
}

/** Questions due now about choices BK has lived with for a week (Q6). `now` is injectable for tests. */
export function outcomeQuestions(app: App, ref: string, now = Date.now()): OutcomeQuestion[] {
  return dueOutcomeQuestions(app.db, getLayout(app, ref).layout.id, now);
}

/** "Not now": the question is not asked again, and the decision stays a hypothesis. */
export function dismissOutcome(app: App, id: string): DecisionRow {
  showDecision(app, id);
  return dismissOutcomeQuestion(app.db, id);
}

export type { OutcomeQuestion, OutcomeStatus } from "../memory/choices.ts";
