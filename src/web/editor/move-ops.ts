// Moving and copying keys (16#moving-and-copying-keys, D-091). Each function returns the ops for
// one change set, so a swap, a drag, a paste and a quick-assign run each undo in one step.
import type { ChangeOp, Slot } from "../../layout/change.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import { bindingSummary, sameBinding } from "./draft.ts";

export const sameSlot = (a: Slot, b: Slot) => a.layerId === b.layerId && a.position === b.position;

export const bindingAt = (layout: Layout, slot: Slot): Binding | undefined => layout.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position];

const slotName = (layout: Layout, slot: Slot) => `${layout.layers.find((layer) => layer.id === slot.layerId)?.name ?? slot.layerId} key ${slot.position + 1}`;

/** Two keys exchange bindings, on this layer or across layers. Null for the same key twice. */
export function swapOps(a: Slot, b: Slot): ChangeOp[] | null {
  return sameSlot(a, b) ? null : [{ op: "swapBindings", a, b }];
}

export function swapSummary(layout: Layout, a: Slot, b: Slot): string {
  return `Swapped ${slotName(layout, a)} (${summaryAt(layout, a)}) and ${slotName(layout, b)} (${summaryAt(layout, b)})`;
}

const summaryAt = (layout: Layout, slot: Slot) => {
  const binding = bindingAt(layout, slot);
  return binding === undefined ? "nothing" : bindingSummary(binding, layout);
};

/** One key's binding copied onto another. Null when they are the same key or already alike. */
export function copyOps(layout: Layout, from: Slot, to: Slot): ChangeOp[] | null {
  const binding = bindingAt(layout, from);
  const current = bindingAt(layout, to);
  if (binding === undefined || current === undefined || sameSlot(from, to) || sameBinding(binding, current)) return null;
  return [{ op: "setBinding", at: to, binding: structuredClone(binding) }];
}

export function copySummary(layout: Layout, from: Slot, to: Slot): string {
  return `Copied ${slotName(layout, from)} (${summaryAt(layout, from)}) onto ${slotName(layout, to)}`;
}

/** The copied binding onto every target that doesn't already have it; null when there is nothing to change. */
export function pasteOps(layout: Layout, clipboard: Binding, targets: readonly Slot[]): ChangeOp[] | null {
  const ops: ChangeOp[] = [];
  for (const target of targets) {
    const current = bindingAt(layout, target);
    if (current === undefined || sameBinding(current, clipboard)) continue;
    ops.push({ op: "setBinding", at: target, binding: structuredClone(clipboard) });
  }
  return ops.length === 0 ? null : ops;
}

export function pasteSummary(layout: Layout, clipboard: Binding, targets: readonly Slot[]): string {
  const what = bindingSummary(clipboard, layout);
  const first = targets[0];
  return targets.length === 1 && first !== undefined ? `Pasted ${what} onto ${slotName(layout, first)}` : `Pasted ${what} onto ${targets.length} keys`;
}

/** Typed keys given to the selected keys in order; extra keystrokes beyond the selection are dropped. */
export function quickAssignOps(targets: readonly Slot[], codes: readonly string[]): ChangeOp[] | null {
  const ops: ChangeOp[] = [];
  for (const [index, code] of codes.entries()) {
    const at = targets[index];
    if (at === undefined) break;
    ops.push({ op: "setBinding", at, binding: { kind: "key", code } });
  }
  return ops.length === 0 ? null : ops;
}

export function quickAssignSummary(layout: Layout, targets: readonly Slot[], codes: readonly string[]): string {
  const count = Math.min(targets.length, codes.length);
  const first = targets[0];
  return count === 1 && first !== undefined ? `Typed a key onto ${slotName(layout, first)}` : `Typed ${count} keys onto ${count} selected keys`;
}
