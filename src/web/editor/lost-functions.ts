// The editor's answer to function_lost (D-092): which functions a draft would lose, where each could
// be put instead, and the ops that carry the person's choice. Pure, so it is tested without a browser.
import type { ChangeOp, Slot } from "../../layout/change.ts";
import { bindingFunctions } from "../../layout/functions.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import { layerTarget } from "../../validation/reachability.ts";
import type { ValidationResult } from "../../validation/result.ts";
import { keyIn } from "../../validation/words.ts";

export interface LostFunction {
  function: string;
  /** The keys that held it before the change. */
  was: Slot[];
}

/** A function the person chose to keep, and the key they chose to put it on. */
export interface Placement {
  function: string;
  slot: Slot;
  /** The binding that carries it, copied from where it was. */
  binding: Binding;
}

/** The functions the validator says the change would lose and that nobody has licensed yet. */
export function lostFunctionsIn(result: ValidationResult): LostFunction[] {
  return result.errors.flatMap((issue) =>
    issue.code === "function_lost" && issue.function !== undefined ? [{ function: issue.function, was: issue.slots ?? [] }] : []);
}

const sameSlot = (a: Slot, b: Slot) => a.layerId === b.layerId && a.position === b.position;

/**
 * The lost functions that came off the keys this draft touches (the edited key and any key a kept
 * function was put on). The rest were only on a layer that nothing reaches any more; they come
 * back when the key that reaches the layer is kept, so they are summarised, not asked about one by one.
 */
export function splitLost(lost: readonly LostFunction[], touched: readonly Slot[]): { direct: LostFunction[]; collateral: LostFunction[] } {
  const direct: LostFunction[] = [];
  const collateral: LostFunction[] = [];
  for (const entry of lost) (entry.was.some((slot) => touched.some((t) => sameSlot(slot, t))) ? direct : collateral).push(entry);
  return { direct, collateral };
}

/**
 * Dropping the key that switches to a layer nothing else reaches would leave the layer unreachable,
 * and no dropFunction licenses that, so the only way forward is to keep the key somewhere.
 */
export function canDrop(lost: LostFunction, layout: Layout, result: ValidationResult): boolean {
  const binding = placeableBinding(layout, lost);
  const target = binding === null ? undefined : layerTarget(binding, layout)?.layerId;
  return target === undefined || !result.errors.some((issue) => issue.code === "layer_unreachable" && issue.layerId === target);
}

/**
 * The binding that would carry `fn` to another key: the one it was on. A hold-tap carries both its
 * halves, which is what "put it somewhere" means for a key that held two functions. A function that
 * lived only in a combo has no key to copy, so it can be dropped but not placed.
 */
export function placeableBinding(layout: Layout, lost: LostFunction): Binding | null {
  for (const slot of lost.was) {
    const binding = layout.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position];
    if (binding !== undefined && bindingFunctions(binding, layout.tapDances).includes(lost.function)) return binding;
  }
  return null;
}

/** The ops of one editor change set: the key itself, the keys that got a kept function, then the drops. */
export function editorOps(slot: Slot, binding: Binding, placements: readonly Placement[], drops: ReadonlyMap<string, string>): ChangeOp[] {
  return [
    { op: "setBinding", at: slot, binding },
    ...placements.map((placement): ChangeOp => ({ op: "setBinding", at: placement.slot, binding: placement.binding })),
    ...[...drops].map(([fn, reason]): ChangeOp => ({ op: "dropFunction", function: fn, reason })),
  ];
}

/** "Replaced by F17 on the A key on Layer 0": named by what the key prints, never its number (D-279). */
export function dropReason(replacedBy: string, layout: Layout, slot: Slot): string {
  return `Replaced by ${replacedBy} on ${keyIn(layout, slot)}`;
}

/** "the A key on Layer 0": a key named by what it prints (D-279). */
export function keyName(layout: Layout, slot: Slot): string {
  return keyIn(layout, slot);
}

/** The layer a lost key switches to, for the sentence that says why it can't simply be dropped. */
export function layerReachedBy(layout: Layout, lost: LostFunction): string | null {
  const binding = placeableBinding(layout, lost);
  const id = binding === null ? undefined : layerTarget(binding, layout)?.layerId;
  return id === undefined ? null : (layout.layers.find((layer) => layer.id === id)?.name ?? null);
}
