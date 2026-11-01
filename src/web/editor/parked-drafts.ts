// Drafts kept when a key's card closes (D-317): closing the card, switching layer or opening ⌘K no longer throws away or blocks on an
// unapplied change. Each is kept by its key until it is applied or discarded, drawn on the board as a dashed amber draft, and sent to
// the agent with the next message. Pure, so the rules are tested without a browser.
import type { Slot } from "../../layout/change.ts";
import type { Binding, Layout, SensorBinding } from "../../layout/schema.ts";
import { deepEqual } from "../../layout/equal.ts";
import type { Draft } from "./draft.ts";

export type Parked = {
  slot: Slot;
  /** The card's own working state, so the key reopens exactly where it was left. */
  panel: Draft;
  /** The draft as a binding when it is complete; null while it is still incomplete (a hold with no modifier, say). */
  binding: Binding | null;
  /** What the key was when the draft was kept: if the key changes under it (an undo, the chat), the draft no longer applies. */
  original: Binding;
};

export type ParkedDrafts = ReadonlyMap<string, Parked>;

export const slotKey = (slot: Slot): string => `${slot.layerId}:${slot.position}`;

export function park(drafts: ParkedDrafts, entry: Parked): ParkedDrafts {
  const next = new Map(drafts);
  next.set(slotKey(entry.slot), entry);
  return next;
}

export function unpark(drafts: ParkedDrafts, slot: Slot): ParkedDrafts {
  if (!drafts.has(slotKey(slot))) return drafts;
  const next = new Map(drafts);
  next.delete(slotKey(slot));
  return next;
}

/** The drafts whose key is still what it was when they were kept, and the ones that no longer apply. */
export function stillApplying(drafts: ParkedDrafts, layout: Layout): { kept: ParkedDrafts; dropped: Parked[] } {
  const dropped: Parked[] = [];
  const kept = new Map<string, Parked>();
  for (const [key, entry] of drafts) {
    const layer = layout.layers.find((l) => l.id === entry.slot.layerId);
    const now = layer?.bindings[entry.slot.position];
    const turnsUnchanged = entry.panel.sensorBindings === undefined || deepEqual(entry.panel.sensorBindingsOriginal, layer?.sensorBindings ?? null);
    if (now !== undefined && deepEqual(now, entry.original) && turnsUnchanged) kept.set(key, entry);
    else dropped.push(entry);
  }
  return dropped.length === 0 ? { kept: drafts, dropped } : { kept, dropped };
}

/** The keys on one layer that hold a kept draft. */
export const draftsOn = (drafts: ParkedDrafts, layerId: string): number[] =>
  [...drafts.values()].filter((d) => d.slot.layerId === layerId).map((d) => d.slot.position);

/** The complete drafts, as the chat sends them to the agent (D-317). */
export const draftsForChat = (drafts: ParkedDrafts): Array<{ layerId: string; position: number; binding: Binding; sensorBindings?: SensorBinding[] | null }> =>
  [...drafts.values()].flatMap((d) => {
    if (d.binding === null) return [];
    const draft: ReturnType<typeof draftsForChat>[number] = { layerId: d.slot.layerId, position: d.slot.position, binding: d.binding };
    if (d.panel.sensorBindings !== undefined) draft.sensorBindings = d.panel.sensorBindings;
    return [draft];
  });
