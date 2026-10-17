// What the layer menu, the strip and the delete dialog need from conditional layers (D-385), pure so it is tested without React.
// The model and its validator rules live in layout/; this only builds the changes a person's clicks mean and the words for them.
import type { ChangeOp } from "../../layout/change.ts";
import { addConditionalLayerChange, conditionalLayerName, conditionsOnLayer, conditionsThatTurnOn, removeConditionalLayerChange } from "../../layout/conditional-layers.ts";
import { layerShortLabel, niceLayerName } from "../../layout/layer-ops.ts";
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

/** A new condition for `thenLayerId` from the first two other layers, or why there can't be one. */
export function newConditionChange(layout: Layout, thenLayerId: string): { ops: ChangeOp[]; id: string } | { reason: string } {
  const others = layout.layers.filter((l) => l.id !== thenLayerId);
  if (others.length < 2) return { reason: "Needs two other layers" };
  // Skips pairs already used for this layer, so a second condition is not a duplicate of the first.
  for (let i = 0; i < others.length; i += 1) {
    for (let j = i + 1; j < others.length; j += 1) {
      const made = addConditionalLayerChange(layout, [(others[i] as { id: string }).id, (others[j] as { id: string }).id], thenLayerId);
      if (made !== null) return made;
    }
  }
  return { reason: "Every pair of other layers already turns this one on" };
}

/** "Lower + Raise gives Adjust" for the change summary and the toast. */
export const conditionSummary = (layout: Layout, c: ConditionalLayer, verb: "Added" | "Changed" | "Removed"): string => `${verb} the condition ${conditionalLayerName(layout, c)}`;

/** Deleting a layer takes the conditions that name it along, before the layer goes, so no step leaves one pointing at nothing. */
export function deleteLayerOps(layout: Pick<Layout, "conditionalLayers">, layerId: string, dropOps: readonly ChangeOp[]): ChangeOp[] {
  return [...dropOps, ...conditionsOnLayer(layout, layerId).flatMap((c) => removeConditionalLayerChange(c.id)), { op: "removeLayer", layerId }];
}

/** The conditions that go with a layer, in words, for the delete dialog. */
export const goingWithLayer = (layout: Layout, layerId: string): string[] => conditionsOnLayer(layout, layerId).map((c) => conditionalLayerName(layout, c));

/** The strip's quiet link on the tab of the layer a condition turns on: "LOW + RAI". */
export function stripLinks(layout: Layout, layerId: string): Array<{ id: string; text: string; label: string }> {
  const find = (id: string) => layout.layers.find((l) => l.id === id);
  const short = (id: string) => { const l = find(id); return l === undefined ? id : layerShortLabel(l); };
  const full = (id: string) => { const l = find(id); return l === undefined ? id : niceLayerName(l.name); };
  return conditionsThatTurnOn(layout, layerId).map((c) => {
    const [a, b] = c.ifLayerIds as [string, string];
    return { id: c.id, text: `${short(a)} + ${short(b)}`, label: `Also on when ${full(a)} and ${full(b)} are held. Open the condition.` };
  });
}
