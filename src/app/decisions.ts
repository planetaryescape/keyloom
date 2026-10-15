// Use cases for decision memory (08). Only priorities exist so far; `choice` decisions arrive with
// rung 6 and will share list, show, edit and retire.
import { type RecordPriorityInput, activePriorities, recordPriority as savePriority } from "../memory/priorities.ts";
import {
  type DecisionRow, type DecisionStatus, findDecision, listDecisions as listRows, updateDecision,
} from "../persistence/decisions.ts";
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

export function editDecision(app: App, id: string, fields: { goal?: string; choice?: string; reason?: string; status?: DecisionStatus }): DecisionRow {
  showDecision(app, id);
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string" && name !== "status" && !value.trim()) throw new UsageError(`the ${name} must not be empty`);
  }
  updateDecision(app.db, id, fields);
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
