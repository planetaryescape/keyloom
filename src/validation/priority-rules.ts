// The two warnings that use what BK has said matters (07#warnings). Both are reminders and never
// block (D-023): an old statement prompts a second look, it does not forbid a new decision.
import type { Slot } from "../layout/change.ts";
import type { Layout } from "../layout/schema.ts";
import type { Issue } from "./result.ts";

/** A `pinned` priority reduced to what the check needs; the app builds these from stored decisions (08). */
export type PinnedPriority = {
  decisionId: string;
  /** BK's own words, quoted back in the warning. */
  statement: string;
  slots: Slot[];
  functions: string[];
};

/** 07: above this many moved functions the cost is muscle memory BK should choose knowingly. */
export const LARGE_RELEARN_THRESHOLD = 6;

export const slotKey = (s: Slot) => `${s.layerId}:${s.position}`;

/** "Layer 0, key 30": key numbers are one-based, as the editor shows them. */
export const slotText = (doc: Layout, s: Slot) => `${doc.layers.find((l) => l.id === s.layerId)?.name ?? s.layerId}, key ${s.position + 1}`;

/**
 * `moved_pinned`: the change alters a slot a priority pins, or takes a pinned function out of a slot
 * it held. Moving it and putting it back elsewhere still counts, because the point of pinning is that
 * BK's hands know where it is. One warning per priority, naming the keys it vacated.
 */
export function movedPinned(
  before: Layout,
  changed: readonly Slot[],
  beforeHomes: ReadonlyMap<string, Slot[]>,
  afterHomes: ReadonlyMap<string, Slot[]>,
  pins: readonly PinnedPriority[],
): Issue[] {
  const changedKeys = new Set(changed.map(slotKey));
  const out: Issue[] = [];
  for (const pin of pins) {
    const touched = new Map<string, Slot>();
    for (const slot of pin.slots) if (changedKeys.has(slotKey(slot))) touched.set(slotKey(slot), slot);
    for (const fn of pin.functions) {
      const kept = new Set((afterHomes.get(fn) ?? []).map(slotKey));
      for (const slot of beforeHomes.get(fn) ?? []) if (!kept.has(slotKey(slot))) touched.set(slotKey(slot), slot);
    }
    if (touched.size === 0) continue;
    const slots = [...touched.values()];
    out.push({
      code: "moved_pinned",
      message: `You asked to keep this where it is ("${pin.statement}"), and this change moves it: ${slots.map((s) => slotText(before, s)).join("; ")}`,
      slots,
    });
  }
  return out;
}

/** `large_relearn`: `relearnCount` is functions that moved position (07#reachability). */
export function largeRelearn(relearnCount: number): Issue[] {
  if (relearnCount <= LARGE_RELEARN_THRESHOLD) return [];
  return [{
    code: "large_relearn",
    message: `${relearnCount} functions change position, which is a lot of muscle memory to relearn; choose this knowingly`,
  }];
}
