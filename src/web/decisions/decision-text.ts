// Words for decisions, kept apart from the components so they are tested without a browser.
import type { DecisionCard } from "../../api/http.ts";
import type { Slot } from "../../layout/change.ts";
import type { Layout } from "../../layout/schema.ts";
import { KEYCODES } from "../../layout/keycodes.ts";
import { functionLabel } from "../editor/function-label.ts";
import { keyIn } from "../../validation/words.ts";

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

/** "the ⌫ key on Layer 0": a key by what it prints, never its number (D-279). */
export function slotName(layout: Layout, slot: Slot): string {
  return keyIn(layout, slot);
}

const MAX_NAMED = 4;

/** The keys a decision is about, named, with the rest counted so a big rearrangement stays one line. */
export function keysLine(layout: Layout, d: Pick<DecisionCard, "subject">): string {
  const slots = d.subject.slots ?? [];
  // A priority about a thing (Caps Lock) rather than a place names it the way the proposal diff does.
  if (slots.length === 0) return (d.subject.functions ?? []).map((fn) => subjectName(fn, layout)).join(", ");
  const named = slots.slice(0, MAX_NAMED).map((s) => slotName(layout, s));
  return slots.length > MAX_NAMED ? `${named.join("; ")} and ${slots.length - MAX_NAMED} more` : named.join("; ");
}

const KEY_NAMES = new Map<string, string>(KEYCODES.map((k) => [k.name, k.label]));

/** A plain key reads by its full name in a list ("Caps Lock", not "CAPS"); anything else as the proposal diff names it. */
function subjectName(fn: string, layout: Layout): string {
  const plain = /^key:([A-Z0-9_]+)$/.exec(fn)?.[1];
  return (plain === undefined ? undefined : KEY_NAMES.get(plain)) ?? functionLabel(fn, layout);
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
