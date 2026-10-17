// Conditional layers (D-385): "when layers A and B are both on, also turn on C". Pure helpers the editor, the agent, the
// validator and the generators share, so all of them read a condition the same way.
import { layerDisplayName } from "./cap-words.ts";
import type { ChangeOp } from "./change.ts";
import type { ConditionalLayer, Layout } from "./schema.ts";

/** An id no conditional layer has, from the layer it turns on: `cond-adjust`, a second one `cond-adjust-2`. */
export function newConditionalLayerId(layout: Pick<Layout, "conditionalLayers">, thenLayerId: string): string {
  const taken = new Set(layout.conditionalLayers.map((c) => c.id));
  const base = `cond-${thenLayerId}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const nameOf = (layout: Pick<Layout, "layers">, id: string): string => {
  const name = layout.layers.find((l) => l.id === id)?.name;
  return name === undefined ? id : layerDisplayName(name);
};

/** "Lower + Raise gives Adjust": the condition by the layers' names, for lists, history and the agent. */
export function conditionalLayerName(layout: Pick<Layout, "layers">, c: ConditionalLayer): string {
  return `${nameOf(layout, c.ifLayerIds[0] as string)} + ${nameOf(layout, c.ifLayerIds[1] as string)} gives ${nameOf(layout, c.thenLayerId)}`;
}

/** The conditions that turn `layerId` on. */
export const conditionsThatTurnOn = (layout: Pick<Layout, "conditionalLayers">, layerId: string): ConditionalLayer[] =>
  layout.conditionalLayers.filter((c) => c.thenLayerId === layerId);

/** The conditions that read `layerId` as one of their two layers (not the one they turn on). */
export const conditionsThatRead = (layout: Pick<Layout, "conditionalLayers">, layerId: string): ConditionalLayer[] =>
  layout.conditionalLayers.filter((c) => c.ifLayerIds.includes(layerId));

/** Every condition that names the layer, either side. */
export const conditionsOnLayer = (layout: Pick<Layout, "conditionalLayers">, layerId: string): ConditionalLayer[] =>
  layout.conditionalLayers.filter((c) => c.thenLayerId === layerId || c.ifLayerIds.includes(layerId));

/** Why a condition can't be, as a sentence for the person; null when it is sound. */
export function conditionProblem(layout: Pick<Layout, "layers">, c: Pick<ConditionalLayer, "ifLayerIds" | "thenLayerId">): string | null {
  const [a, b] = c.ifLayerIds;
  const known = (id: string | undefined) => id !== undefined && layout.layers.some((l) => l.id === id);
  if (!known(a) || !known(b) || !known(c.thenLayerId)) return "it names a layer that isn't in this layout";
  if (a === b) return "the two layers it waits for are the same layer";
  if (c.thenLayerId === a || c.thenLayerId === b) return "the layer it turns on is one of the two it waits for";
  return null;
}

/** Turns `thenLayerId` on while both `ifLayerIds` are on. Null when the condition is unsound or already there. */
export function addConditionalLayerChange(layout: Layout, ifLayerIds: readonly [string, string], thenLayerId: string): { ops: ChangeOp[]; id: string } | null {
  if (conditionProblem(layout, { ifLayerIds: [...ifLayerIds], thenLayerId }) !== null) return null;
  const same = (c: ConditionalLayer) => c.thenLayerId === thenLayerId && c.ifLayerIds.every((id) => ifLayerIds.includes(id));
  if (layout.conditionalLayers.some(same)) return null;
  const id = newConditionalLayerId(layout, thenLayerId);
  return { ops: [{ op: "upsertConditionalLayer", conditionalLayer: { id, ifLayerIds: [...ifLayerIds], thenLayerId } }], id };
}

export const removeConditionalLayerChange = (conditionalLayerId: string): ChangeOp[] => [{ op: "removeConditionalLayer", conditionalLayerId }];
