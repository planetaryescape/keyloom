// Words for decisions, kept apart from the components so they are tested without a browser.
import type { DecisionCard } from "../../api/http.ts";
import type { Slot } from "../../layout/change.ts";
import type { Layout } from "../../layout/schema.ts";

export const STATUS_WORDS: Record<DecisionCard["status"], string> = {
  hypothesis: "Not tested yet",
  tried_helpful: "Helped",
  tried_unhelpful: "Didn't help",
  superseded: "Replaced",
  retired: "Retired",
};

export const PRIORITY_WORDS: Record<NonNullable<DecisionCard["priorityKind"]>, string> = {
  pinned: "Keep in place",
  rarely_used: "Rarely used",
  frequent: "Used often",
  willing_to_relearn: "Happy to relearn",
};

/** What kind of thing it is, in the decisions list. */
export const kindWords = (d: DecisionCard): string => (d.kind === "priority" ? PRIORITY_WORDS[d.priorityKind ?? "pinned"] : "Choice");

/** "Layer 0, key 43", the way the editor names a key (key numbers count from 1). */
export function slotName(layout: Layout, slot: Slot): string {
  return `${layout.layers.find((l) => l.id === slot.layerId)?.name ?? slot.layerId}, key ${slot.position + 1}`;
}

const MAX_NAMED = 4;

/** The keys a decision is about, named, with the rest counted so a big rearrangement stays one line. */
export function keysLine(layout: Layout, d: Pick<DecisionCard, "subject">): string {
  const slots = d.subject.slots ?? [];
  if (slots.length === 0) return (d.subject.functions ?? []).join(", ");
  const named = slots.slice(0, MAX_NAMED).map((s) => slotName(layout, s));
  return slots.length > MAX_NAMED ? `${named.join("; ")} and ${slots.length - MAX_NAMED} more` : named.join("; ");
}

/** Active decisions first (newest first, as the server sends them), then the ones that were replaced. */
export function splitByLife(decisions: readonly DecisionCard[]): { active: DecisionCard[]; replaced: DecisionCard[] } {
  return {
    active: decisions.filter((d) => d.status !== "superseded" && d.status !== "retired"),
    replaced: decisions.filter((d) => d.status === "superseded"),
  };
}

/** The decision that replaced `d`, if it is still listed, so "Replaced by" can name what took over. */
export function successorOf(d: DecisionCard, all: readonly DecisionCard[]): DecisionCard | undefined {
  return d.supersededBy === null ? undefined : all.find((x) => x.id === d.supersededBy);
}
