// Priorities: what BK says matters about a layout, kept as decisions of kind `priority` (08).
// The agent records them through `record_priority` as he states them; the validator reads the
// pinned ones, and the whole active set goes into the agent's context.
import type { Database } from "bun:sqlite";
import { type DecisionRow, type PriorityKind, type Subject, insertPriority, listDecisions } from "../persistence/decisions.ts";

export { PRIORITY_KINDS, type PriorityKind, type Subject } from "../persistence/decisions.ts";

/** The priority kind in words: it is the `choice` column, so the CLI and the decisions view read naturally. */
export const PRIORITY_WORDS: Record<PriorityKind, string> = {
  pinned: "Keep it where it is",
  rarely_used: "Rarely used, so it can give up its place",
  frequent: "Used often, so it should stay easy to reach",
  willing_to_relearn: "Willing to relearn it in a new place",
};

/** Used when BK gave no reason (08). */
export const STATED_BY_BK = "stated by BK";

/** Two statements about the same thing in the same way are one priority, however the model spelled the subject. */
function subjectKey(subject: Subject): string {
  const slots = [...(subject.slots ?? [])].map((s) => `${s.layerId}:${s.position}`).sort();
  return JSON.stringify([slots, [...(subject.functions ?? [])].sort()]);
}

export type RecordPriorityInput = {
  layoutId: string;
  priorityKind: PriorityKind;
  subject: Subject;
  statement: string;
  reason?: string;
  conversationId?: string;
  sourceMessageIds?: string[];
};

/** `created` is false when an active priority already said the same, so a repeated statement doesn't stack up chips. */
export function recordPriority(db: Database, input: RecordPriorityInput): { decision: DecisionRow; created: boolean } {
  const key = subjectKey(input.subject);
  const existing = listDecisions(db, input.layoutId, { kind: "priority", active: true }).find(
    (d) => d.priorityKind === input.priorityKind && subjectKey(d.subject) === key,
  );
  if (existing) return { decision: existing, created: false };
  const reason = input.reason?.trim();
  return {
    decision: insertPriority(db, {
      layoutId: input.layoutId,
      priorityKind: input.priorityKind,
      subject: input.subject,
      goal: input.statement.trim(),
      choice: PRIORITY_WORDS[input.priorityKind],
      reason: reason ? reason : STATED_BY_BK,
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(input.sourceMessageIds === undefined ? {} : { sourceMessageIds: input.sourceMessageIds }),
    }),
    created: true,
  };
}

export const activePriorities = (db: Database, layoutId: string): DecisionRow[] => listDecisions(db, layoutId, { kind: "priority", active: true });
