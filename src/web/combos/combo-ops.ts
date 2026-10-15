// Combos made from a selection (16#combos-are-made-from-a-selection, D-089). Pure, so the rules are
// tested without a browser. A combo is stored by key position, which is what both firmwares need.
import type { ChangeOp } from "../../layout/change.ts";
import type { Binding, Combo, Layout } from "../../layout/schema.ts";
import { bindingSummary } from "../editor/draft.ts";

/** Two keys at least make a combo; the firmware has no ceiling of its own that keyloom knows (16#positions). */
export const MIN_COMBO_KEYS = 2;

/** "Esc combo": named from what it does, so the person never has to type a name. */
export function comboNameFor(layout: Layout, output: Binding, ignoreId?: string): string {
  const base = `${bindingSummary(output, layout)} combo`;
  const taken = new Set(layout.combos.filter((combo) => combo.id !== ignoreId).map((combo) => combo.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** An id no combo has: `combo-1`, `combo-2`. */
export function newComboId(layout: Layout): string {
  const taken = new Set(layout.combos.map((combo) => combo.id));
  for (let n = layout.combos.length + 1; ; n += 1) if (!taken.has(`combo-${n}`)) return `combo-${n}`;
}

const sameKeys = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((position) => b.includes(position));

const layersOverlap = (a: Combo["layerIds"], b: Combo["layerIds"]) => a === "all" || b === "all" || a.some((id) => b.includes(id));

/** A combo already made from exactly these keys on a layer this one also covers: the firmware could only honour one. */
export function conflictingCombo(layout: Layout, positions: readonly number[], layerIds: Combo["layerIds"], ignoreId?: string): Combo | undefined {
  return layout.combos.find((combo) => combo.id !== ignoreId && sameKeys(combo.positions, positions) && layersOverlap(combo.layerIds, layerIds));
}

/** The layers a picked set means: every layer reads as "all", so a combo added later still applies. */
export function layersFromChoice(layout: Layout, chosen: readonly string[]): Combo["layerIds"] | null {
  const ids = layout.layers.map((layer) => layer.id).filter((id) => chosen.includes(id));
  if (ids.length === 0) return null;
  return ids.length === layout.layers.length ? "all" : ids;
}

/** The combo a selection makes before the person has picked its output: it does nothing yet, so it is not saved until they choose. */
export function newCombo(layout: Layout, positions: readonly number[], output: Binding): Combo {
  return {
    id: newComboId(layout),
    name: comboNameFor(layout, output),
    positions: [...positions].sort((a, b) => a - b),
    layerIds: "all",
    output,
  };
}

export const upsertComboOps = (combo: Combo): ChangeOp[] => [{ op: "upsertCombo", combo }];
export const removeComboOps = (comboId: string): ChangeOp[] => [{ op: "removeCombo", comboId }];

/** Why a combo can't be saved as it stands, in words for the person; null when it can. */
export function comboProblem(layout: Layout, combo: Combo, isNew: boolean): string | null {
  if (combo.positions.length < MIN_COMBO_KEYS) return "A combo needs at least two keys.";
  const clash = conflictingCombo(layout, combo.positions, combo.layerIds, isNew ? undefined : combo.id);
  if (clash !== undefined) return `These keys already make ${clash.name} on the same layers.`;
  return null;
}

/** The history line for a combo change. */
export function comboSummary(layout: Layout, combo: Combo, verb: "Added" | "Changed" | "Removed"): string {
  const keys = combo.positions.map((position) => position + 1).join(" + ");
  return `${verb} combo ${combo.name} (keys ${keys})`;
}

/** Combos that apply on a layer, for the lines drawn over the board. */
export function combosOn(layout: Layout, layerId: string): Combo[] {
  return layout.combos.filter((combo) => combo.layerIds === "all" || combo.layerIds.includes(layerId));
}
