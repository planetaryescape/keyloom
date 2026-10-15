// The ops one key's draft stands for: the tap dance entry and macros it needs, the key's own binding,
// and removing a dance nothing uses any more, all in the one change set (16, D-086). Pure.
import { applyOps } from "../../layout/apply-ops.ts";
import type { ChangeOp, Slot } from "../../layout/change.ts";
import { deepEqual } from "../../layout/equal.ts";
import { tapDanceSlots } from "../../layout/functions.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import { type Draft, isDance } from "../editor/draft.ts";
import { type Placement, editorOps } from "../editor/lost-functions.ts";
import { danceFromDraft, danceUsers, newDanceId } from "./dance.ts";

export interface KeyChange {
  ops: ChangeOp[];
  /** What the key becomes. */
  binding: Binding;
  /** The layout once the ops are applied, to describe and draw the draft; null if they don't apply. */
  after: Layout | null;
  /** The tap dance id the key ends up with, if it is one. */
  danceId: string | null;
}

/** Ids of the macros the draft's slots point at. */
function macroIdsOf(draft: Draft): Set<string> {
  const ids = new Set<string>();
  if (draft.kind === "macro" && draft.macroId !== null) ids.add(draft.macroId);
  for (const slot of [draft.doubleTap, draft.tapThenHold]) if (slot?.kind === "macro") ids.add(slot.macroId);
  return ids;
}

/** Whether any binding or combo output in the layout is the tap dance. */
function danceUsed(layout: Layout, id: string): boolean {
  return layout.layers.some((layer) => layer.bindings.some((b) => b.kind === "tapDance" && b.tapDanceId === id)) || layout.combos.some((c) => c.output.kind === "tapDance" && c.output.tapDanceId === id);
}

/**
 * The ops for `draft` on `slot`. A dance used by other keys is changed for this key only (a copy with a
 * new id) unless the draft says every key, so editing one key never rewrites another.
 */
export function keyChange(input: {
  layout: Layout;
  slot: Slot;
  draft: Draft;
  /** The draft as a binding (bindingFromDraft); the caller has checked it is complete. */
  binding: Binding;
  original: Binding;
  placements: readonly Placement[];
  drops: ReadonlyMap<string, string>;
}): KeyChange {
  const { layout, slot, draft, original, placements, drops } = input;
  const pre: ChangeOp[] = [];
  const wanted = macroIdsOf(draft);
  // Only macros a slot points at are saved: one built and then swapped away is not.
  for (const macro of draft.pendingMacros) if (wanted.has(macro.id)) pre.push({ op: "upsertMacro", macro });

  let binding = input.binding;
  let danceId: string | null = null;
  if (isDance(draft) && draft.danceId !== null) {
    const existing = layout.tapDances.find((t) => t.id === draft.danceId);
    const entry = danceFromDraft(draft, layout, draft.danceId);
    const sharedElsewhere = existing !== undefined && danceUsers(layout, existing.id, slot).length > 0;
    const edited = entry !== null && existing !== undefined && !deepEqual(entry, existing);
    // Changing a shared dance for this key only makes it a copy of its own.
    const forked = edited && sharedElsewhere && !draft.danceForAll;
    const id = forked ? newDanceId(layout, slot.layerId, slot.position) : draft.danceId;
    const final = entry === null ? null : danceFromDraft(draft, layout, id);
    if (final !== null && (existing === undefined || edited || forked)) pre.push({ op: "upsertTapDance", tapDance: final });
    binding = { kind: "tapDance", tapDanceId: id };
    danceId = id;
  }

  const base = editorOps(slot, binding, placements, drops);
  const firstDrop = base.findIndex((op) => op.op === "dropFunction");
  const bindings = firstDrop < 0 ? base : base.slice(0, firstDrop);
  const dropOps = firstDrop < 0 ? [] : base.slice(firstDrop);

  // The dance this key had, if nothing uses it once the key has changed, goes with the change.
  const post: ChangeOp[] = [];
  if (original.kind === "tapDance" && original.tapDanceId !== danceId) {
    const applied = applyOps(layout, [...pre, ...bindings]);
    if (applied.ok && !danceUsed(applied.layout, original.tapDanceId)) post.push({ op: "removeTapDance", tapDanceId: original.tapDanceId });
  }

  const ops = [...pre, ...bindings, ...post, ...dropOps];
  const result = applyOps(layout, ops);
  return { ops, binding, after: result.ok ? result.layout : null, danceId };
}

/** The keys other than `except` that run the macro, directly or through a tap dance slot. */
export function macroUsers(layout: Layout, macroId: string, except?: Slot): Slot[] {
  return layout.layers.flatMap((layer) =>
    layer.bindings.flatMap((binding, position): Slot[] => {
      const at = { layerId: layer.id, position };
      if (except !== undefined && at.layerId === except.layerId && at.position === except.position) return [];
      if (binding.kind === "macro") return binding.macroId === macroId ? [at] : [];
      if (binding.kind !== "tapDance") return [];
      const dance = layout.tapDances.find((candidate) => candidate.id === binding.tapDanceId);
      return dance !== undefined && tapDanceSlots(dance).some(([, action]) => action.kind === "macro" && action.macroId === macroId) ? [at] : [];
    }),
  );
}
