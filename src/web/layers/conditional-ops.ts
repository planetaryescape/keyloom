// What the layer menu, the strip and the delete dialog need from conditional layers (D-385), pure so it is tested without React.
// The model and its validator rules live in layout/; this only builds the changes a person's clicks mean and the words for them.
import type { ChangeOp } from "../../layout/change.ts";
import { addConditionalLayerChange, conditionalLayerName, conditionsOnLayer, conditionsThatTurnOn, removeConditionalLayerChange } from "../../layout/conditional-layers.ts";
import { niceLayerName } from "../../layout/layer-ops.ts";
import type { ConditionalLayer, Layout } from "../../layout/schema.ts";

type Slot = 0 | 1;

/** The layers a picker may offer: never the layer the condition turns on, never the one the other picker holds. */
export function pickerChoices(layout: Pick<Layout, "layers">, condition: Pick<ConditionalLayer, "ifLayerIds" | "thenLayerId">, slot: Slot): Array<{ id: string; name: string }> {
  const other = condition.ifLayerIds[slot === 0 ? 1 : 0];
  return layout.layers.filter((l) => l.id !== condition.thenLayerId && l.id !== other).map((l) => ({ id: l.id, name: niceLayerName(l.name) }));
}

/** The change that points one picker of a condition at another layer, with the condition as it becomes; null when nothing changes. */
export function setPickerChange(condition: ConditionalLayer, slot: Slot, layerId: string): { ops: ChangeOp[]; next: ConditionalLayer } | null {
  if (condition.ifLayerIds[slot] === layerId) return null;
  const [first, second] = condition.ifLayerIds as [string, string];
  const ifLayerIds: [string, string] = slot === 0 ? [layerId, second] : [first, layerId];
  const next = { ...condition, ifLayerIds };
  return { ops: [{ op: "upsertConditionalLayer", conditionalLayer: next }], next };
}

/** Why no further condition can turn `thenLayerId` on, or null when one can. */
export function noNewCondition(layout: Layout, thenLayerId: string): string | null {
  const others = layout.layers.filter((l) => l.id !== thenLayerId);
  if (others.length < 2) return "It needs two other layers to wait for";
  for (let i = 0; i < others.length; i += 1) {
    for (let j = i + 1; j < others.length; j += 1) {
      if (addConditionalLayerChange(layout, [(others[i] as { id: string }).id, (others[j] as { id: string }).id], thenLayerId) !== null) return null;
    }
  }
  return "Every pair of other layers already turns it on";
}

/** The layers a new condition's picker may offer: not the layer it turns on, not the one already picked. */
export function draftChoices(layout: Pick<Layout, "layers">, thenLayerId: string, picked: string | null): Array<{ id: string; name: string }> {
  return layout.layers.filter((l) => l.id !== thenLayerId && l.id !== picked).map((l) => ({ id: l.id, name: niceLayerName(l.name) }));
}

/** A new condition once both of its layers are picked (nothing is applied before that), or why that pair can't be. */
export function draftChange(layout: Layout, thenLayerId: string, ifLayerIds: readonly [string, string]): { ops: ChangeOp[]; condition: ConditionalLayer } | { reason: string } {
  const made = addConditionalLayerChange(layout, ifLayerIds, thenLayerId);
  if (made === null) return { reason: "Those two already turn it on" };
  return { ops: made.ops, condition: { id: made.id, ifLayerIds: [...ifLayerIds], thenLayerId } };
}

/** "Lower + Raise gives Adjust" for the change summary and the toast. */
export const conditionSummary = (layout: Layout, c: ConditionalLayer, verb: "Added" | "Changed" | "Removed"): string => `${verb} the condition ${conditionalLayerName(layout, c)}`;

/** Deleting a layer takes the conditions that name it along, before the layer goes, so no step leaves one pointing at nothing. */
export function deleteLayerOps(layout: Pick<Layout, "conditionalLayers">, layerId: string, dropOps: readonly ChangeOp[]): ChangeOp[] {
  return [...dropOps, ...conditionsOnLayer(layout, layerId).flatMap((c) => removeConditionalLayerChange(c.id)), { op: "removeLayer", layerId }];
}

/** The conditions that go with a layer, in words, for the delete dialog. */
export const goingWithLayer = (layout: Layout, layerId: string): string[] => conditionsOnLayer(layout, layerId).map((c) => conditionalLayerName(layout, c));

/** The pairs of layers that turn `layerId` on, for the strip's dots and the tab's name in words. */
export function turnedOnBy(layout: Pick<Layout, "layers" | "conditionalLayers">, layerId: string): Array<{ id: string; layerIds: [string, string]; names: [string, string] }> {
  const name = (id: string) => { const l = layout.layers.find((x) => x.id === id); return l === undefined ? id : niceLayerName(l.name); };
  return conditionsThatTurnOn(layout, layerId).map((c) => {
    const [a, b] = c.ifLayerIds as [string, string];
    return { id: c.id, layerIds: [a, b], names: [name(a), name(b)] };
  });
}

/** "also on while Navigation and Symbols are held", with "or" between pairs; null for a layer no condition turns on. */
export function alsoOnWords(layout: Pick<Layout, "layers" | "conditionalLayers">, layerId: string): string | null {
  const pairs = turnedOnBy(layout, layerId);
  if (pairs.length === 0) return null;
  return `also on while ${pairs.map((p) => `${p.names[0]} and ${p.names[1]}`).join(", or ")} are held`;
}
