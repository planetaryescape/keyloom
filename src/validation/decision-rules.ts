// Remembered reasons meeting a change (08, 07#warnings). A decision is a choice keyloom made for a
// reason; when a later change touches the keys it placed, the validator attaches the reason. It
// never blocks (D-023): the old reason prompts a second look, it does not forbid a new decision.
import type { Slot } from "../layout/change.ts";
import type { Layout } from "../layout/schema.ts";
import { slotKey, slotText } from "./priority-rules.ts";
import { keyIn } from "./words.ts";
import type { DecisionReminder, Issue } from "./result.ts";

/** An active `choice` decision reduced to what the check needs; the app builds these from stored decisions. */
export type DecisionFact = {
  decisionId: string;
  goal: string;
  choice: string;
  reason: string;
  status: "hypothesis" | "tried_helpful" | "tried_unhelpful";
  slots: Slot[];
  functions: string[];
};

export type Touched = { fact: DecisionFact; slots: Slot[] };

/**
 * The decisions a change touches, with the keys it touches them at.
 *
 * A decision is about the keys it placed, so a slot whose binding changed, a hold-tap whose feel was
 * retuned, or a removed layer that held it is a touch. A decision with no slots (written by hand
 * about a function) is touched when that function leaves a key it was on. Function matching is not
 * applied to a decision that has slots: a function such as Command can live on several keys, and
 * losing an unrelated copy of it is not a contradiction of this decision.
 */
export function touchedDecisions(
  facts: readonly DecisionFact[],
  change: {
    changed: readonly Slot[];
    retuned: readonly Slot[];
    removedLayerIds: ReadonlySet<string>;
    beforeHomes: ReadonlyMap<string, Slot[]>;
    afterHomes: ReadonlyMap<string, Slot[]>;
  },
): Touched[] {
  const moved = new Set([...change.changed, ...change.retuned].map(slotKey));
  const out: Touched[] = [];
  for (const fact of facts) {
    const hit = new Map<string, Slot>();
    if (fact.slots.length > 0) {
      for (const slot of fact.slots) if (moved.has(slotKey(slot)) || change.removedLayerIds.has(slot.layerId)) hit.set(slotKey(slot), slot);
    } else {
      for (const fn of fact.functions) {
        const kept = new Set((change.afterHomes.get(fn) ?? []).map(slotKey));
        for (const slot of change.beforeHomes.get(fn) ?? []) if (!kept.has(slotKey(slot))) hit.set(slotKey(slot), slot);
      }
    }
    if (hit.size > 0) out.push({ fact, slots: [...hit.values()] });
  }
  return out;
}

const STATUS_NOTE: Record<"hypothesis" | "tried_helpful", string> = {
  hypothesis: "You haven't tested yet whether it helped.",
  tried_helpful: "You tried it and it helped, so change it only for a reason you can state.",
};

/**
 * `contradicts_decision`: one warning and one reminder per decision the change touches. A decision
 * already marked `tried_unhelpful` is skipped, because replacing what did not work is the point.
 */
export function contradictsDecision(before: Layout, touched: readonly Touched[]): { reminders: DecisionReminder[]; warnings: Issue[] } {
  const reminders: DecisionReminder[] = [];
  const warnings: Issue[] = [];
  for (const { fact, slots } of touched) {
    if (fact.status === "tried_unhelpful") continue;
    reminders.push({ decisionId: fact.decisionId, goal: fact.goal, choice: fact.choice, reason: fact.reason, status: fact.status, slots });
    warnings.push({
      code: "contradicts_decision",
      message: `You set this up earlier for "${fact.goal}": ${fact.reason.replace(/[.\s]+$/, "")}. ${STATUS_NOTE[fact.status]} This change alters ${slots.map((s) => slotText(before, s)).join("; ")}.`,
      plain: `You set this up earlier for "${fact.goal}": ${fact.reason.replace(/[.\s]+$/, "")}. ${STATUS_NOTE[fact.status]} This change alters ${slots.map((s) => keyIn(before, s)).join("; ")}.`,
      slots,
    });
  }
  return { reminders, warnings };
}
