// Stale bases (02#applying-undoing-and-stale-bases). A change set is proposed against a base
// revision; if the head has moved on, its ops still apply when they touch only things that are
// unchanged between the base and the head.
import { deepEqual } from "./equal.ts";
import type { ChangeOp, Slot } from "./change.ts";
import type { Layout } from "./schema.ts";

/** Something an op reads or writes, with a way to look it up in any revision of the document. */
type Touch = { label: string; slot?: Slot; read: (doc: Layout) => unknown };

const slotTouch = (s: Slot): Touch => ({
  label: `${s.layerId}:${s.position}`,
  slot: s,
  read: (d) => d.layers.find((l) => l.id === s.layerId)?.bindings[s.position],
});
const nameTouch = (layerId: string): Touch => ({
  label: `layer ${layerId}`,
  read: (d) => d.layers.find((l) => l.id === layerId)?.name,
});
const presenceTouch = (layerId: string): Touch => ({
  label: `layer ${layerId} (exists)`,
  read: (d) => d.layers.some((l) => l.id === layerId),
});
const wholeLayerTouches = (layerId: string, base: Layout): Touch[] => [
  nameTouch(layerId),
  // The base's size is the one the op was proposed against; a head with more or fewer slots differs on the extras.
  ...(base.layers.find((l) => l.id === layerId)?.bindings ?? []).map((_, position) => slotTouch({ layerId, position })),
  { label: `layer ${layerId} (size)`, read: (d) => d.layers.find((l) => l.id === layerId)?.bindings.length },
];
const itemTouch = (kind: string, id: string, read: (d: Layout) => unknown): Touch => ({ label: `${kind} ${id}`, read });

function touchesOf(op: ChangeOp, base: Layout): Touch[] {
  switch (op.op) {
    case "setBinding": return [slotTouch(op.at)];
    case "moveBinding": return [slotTouch(op.from), slotTouch(op.to)];
    case "swapBindings": return [slotTouch(op.a), slotTouch(op.b)];
    // Adding reads the new id's absence and the anchor layer's presence; renaming the anchor doesn't matter.
    case "addLayer": return [presenceTouch(op.layer.id), presenceTouch(op.afterLayerId)];
    case "removeLayer": return wholeLayerTouches(op.layerId, base);
    case "renameLayer": return [nameTouch(op.layerId)];
    case "duplicateLayer": return [...wholeLayerTouches(op.layerId, base), presenceTouch(op.layer.id)];
    // Where a layer sits depends on every other layer's place, so any change of order since the base is a conflict.
    case "moveLayer": return [{ label: "layer order", read: (d) => d.layers.map((l) => l.id) }];
    case "setLayerStyle":
      return [{ label: `layer ${op.layerId} (look)`, read: (d) => { const l = d.layers.find((x) => x.id === op.layerId); return [l?.shortLabel, l?.color]; } }];
    case "setLayerLighting":
      return [{ label: `layer ${op.layerId} (lighting)`, read: (d) => d.layers.find((x) => x.id === op.layerId)?.lighting }];
    case "removeFirmwareSetting":
      return [itemTouch("setting", `${op.firmware}:${op.key}`, (d) => d.settings.find((s) => s.firmware === op.firmware && s.key === op.key))];
    case "upsertMacro": return [itemTouch("macro", op.macro.id, (d) => d.macros.find((m) => m.id === op.macro.id))];
    case "removeMacro": return [itemTouch("macro", op.macroId, (d) => d.macros.find((m) => m.id === op.macroId))];
    case "upsertTapDance": return [itemTouch("tap dance", op.tapDance.id, (d) => d.tapDances.find((t) => t.id === op.tapDance.id))];
    case "removeTapDance": return [itemTouch("tap dance", op.tapDanceId, (d) => d.tapDances.find((t) => t.id === op.tapDanceId))];
    case "upsertCombo": return [itemTouch("combo", op.combo.id, (d) => d.combos.find((c) => c.id === op.combo.id))];
    case "removeCombo": return [itemTouch("combo", op.comboId, (d) => d.combos.find((c) => c.id === op.comboId))];
    case "upsertHoldTapProfile":
      return [itemTouch("hold-tap profile", op.profile.id, (d) => d.holdTapProfiles.find((p) => p.id === op.profile.id))];
    case "setFirmwareSetting": {
      const { firmware, key } = op.setting;
      return [itemTouch("setting", `${firmware}:${key}`, (d) => d.settings.find((s) => s.firmware === firmware && s.key === key))];
    }
    case "dropFunction": return [];
  }
}

export type StaleConflict = { label: string; slot?: Slot };

/** What the ops touch that differs between `base` and `head`. Empty means the ops can apply to the head. */
export function staleConflicts(base: Layout, head: Layout, ops: readonly ChangeOp[]): StaleConflict[] {
  const seen = new Set<string>();
  const out: StaleConflict[] = [];
  for (const touch of ops.flatMap((op) => touchesOf(op, base))) {
    if (seen.has(touch.label)) continue;
    seen.add(touch.label);
    if (!deepEqual(touch.read(base), touch.read(head))) out.push(touch.slot ? { label: touch.label, slot: touch.slot } : { label: touch.label });
  }
  return out;
}
