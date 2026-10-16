// The change ops behind the layer tabs (16#layers-are-managed-in-their-tabs, D-090). Pure, so the
// tabs, the agent and the tests build the same ops. Layers are always named by id; an index only
// says where a layer sits now.
import { layerDisplayName } from "./cap-words.ts";
import type { ChangeOp, Slot } from "./change.ts";
import { defaultShortLabel } from "./legend.ts";
import type { Binding, Layer, Layout } from "./schema.ts";
import { bindingLegend } from "./legend.ts";

export const LAYER_COLOR_COUNT = 6;
export const SHORT_LABEL_MAX = 4;

/** The colour (1 to 6) a layer is drawn in: the one chosen, or the one its place in the list picks. */
export const layerColorOf = (layers: readonly Pick<Layer, "color">[], index: number): number => layers[index]?.color ?? (index % LAYER_COLOR_COUNT) + 1;

/** The label a layer key prints for it: the one chosen, or the first letters of its name. */
export const layerShortLabel = (layer: Pick<Layer, "name" | "shortLabel">): string => layer.shortLabel ?? defaultShortLabel(layer.name);

/** "one_shot" reads as "One shot", "numbers" as "Numbers": firmware spelling is not words a person chose. Display only (D-270). */
export const niceLayerName = (name: string): string => layerDisplayName(name);

function slug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(base) ? base : `layer-${base}`.replace(/-+$/, "");
}

/** An id no layer has, from a name: "Nav" is `nav`, a second one `nav-2`. */
export function newLayerId(layout: Layout, name: string): string {
  const taken = new Set(layout.layers.map((layer) => layer.id));
  const base = slug(name) || "layer";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const nameTaken = (layout: Layout, name: string) => layout.layers.some((layer) => layer.name.toLowerCase() === name.toLowerCase());

/** "Layer 3" for a layout of two layers; later numbers if a layer already has that name. */
export function nextLayerName(layout: Layout): string {
  for (let n = layout.layers.length + 1; ; n += 1) if (!nameTaken(layout, `Layer ${n}`)) return `Layer ${n}`;
}

/** "Nav copy", then "Nav copy 2". */
export function copyLayerName(layout: Layout, name: string): string {
  const first = `${name} copy`;
  if (!nameTaken(layout, first)) return first;
  for (let n = 2; ; n += 1) if (!nameTaken(layout, `${first} ${n}`)) return `${first} ${n}`;
}

export type LayerChange = { ops: ChangeOp[]; layerId: string; name: string };

/** A transparent layer after `afterLayerId` (the last layer when omitted). */
export function addLayerChange(layout: Layout, afterLayerId?: string): LayerChange {
  const name = nextLayerName(layout);
  const layerId = newLayerId(layout, name);
  const after = afterLayerId ?? layout.layers[layout.layers.length - 1]?.id ?? "";
  return { ops: [{ op: "addLayer", layer: { id: layerId, name }, afterLayerId: after }], layerId, name };
}

export function duplicateLayerChange(layout: Layout, layerId: string): LayerChange | null {
  const source = layout.layers.find((layer) => layer.id === layerId);
  if (source === undefined) return null;
  const name = copyLayerName(layout, source.name);
  const id = newLayerId(layout, name);
  return { ops: [{ op: "duplicateLayer", layerId, layer: { id, name } }], layerId: id, name };
}

/**
 * Moves a layer so it ends up at `toIndex` (counted in the list as it is now). The base layer is
 * first and stays first: nothing moves to index 0 and the base itself doesn't move.
 */
export function moveLayerOps(layout: Layout, layerId: string, toIndex: number): ChangeOp[] | null {
  const from = layout.layers.findIndex((layer) => layer.id === layerId);
  if (from < 1 || toIndex < 1 || toIndex >= layout.layers.length || toIndex === from) return null;
  const others = layout.layers.filter((layer) => layer.id !== layerId);
  const after = others[toIndex - 1];
  return after === undefined ? null : [{ op: "moveLayer", layerId, afterLayerId: after.id }];
}

/** Every transparent key on the layer becomes none, or the reverse; null when there is nothing to convert. */
export function convertLayerOps(layout: Layout, layerId: string, from: "transparent" | "none", to: "transparent" | "none"): ChangeOp[] | null {
  const layer = layout.layers.find((candidate) => candidate.id === layerId);
  if (layer === undefined || from === to) return null;
  const ops: ChangeOp[] = [];
  for (const [position, binding] of layer.bindings.entries()) {
    if (binding.kind === from) ops.push({ op: "setBinding", at: { layerId, position }, binding: { kind: to } });
  }
  return ops.length === 0 ? null : ops;
}

export const countKind = (layer: Layer, kind: "transparent" | "none"): number => layer.bindings.filter((binding) => binding.kind === kind).length;

/** Cleans what was typed into a short label: at most four characters, null for empty (back to the default). */
export function cleanShortLabel(text: string): string | null {
  const label = text.trim().slice(0, SHORT_LABEL_MAX);
  return label === "" ? null : label;
}

export type LayerReference = { text: string; slot?: Slot };

const ACTION_WORD = { momentary: "holds", toggle: "toggles", to: "goes to", oneShot: "switches once to" } as const;

/**
 * Everything that would be left pointing at nothing if the layer went: layer keys, hold-tap holds,
 * tap dance slots (named with the keys that carry the dance), combo outputs and combos limited to
 * it. Keys on the layer itself go with it, so they aren't listed.
 */
export function layerReferences(layout: Layout, layerId: string): LayerReference[] {
  const out: LayerReference[] = [];
  const nameOf = (id: string) => layout.layers.find((layer) => layer.id === id)?.name ?? id;
  const target = nameOf(layerId);
  // A key by what it prints, never its number (D-279).
  const where = (slot: Slot) => {
    const binding = layout.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position];
    const tap = binding === undefined ? "" : bindingLegend(binding, { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances }).tap;
    return `The ${tap === "" ? "blank" : tap} key on ${nameOf(slot.layerId)}`;
  };
  const describe = (binding: Binding): string | null => {
    if (binding.kind === "layer" && binding.layerId === layerId) return `${ACTION_WORD[binding.action]} ${target}`;
    if (binding.kind === "holdTap" && "layerId" in binding.hold && binding.hold.layerId === layerId) return `holds ${target}`;
    return null;
  };
  for (const layer of layout.layers) {
    if (layer.id === layerId) continue;
    for (const [position, binding] of layer.bindings.entries()) {
      const slot = { layerId: layer.id, position };
      const said = describe(binding);
      if (said !== null) out.push({ slot, text: `${where(slot)} ${said}` });
      if (binding.kind === "tapDance") {
        const dance = layout.tapDances.find((candidate) => candidate.id === binding.tapDanceId);
        const hit = [dance?.tap, dance?.hold, dance?.doubleTap, dance?.tapThenHold].find((action) => action?.kind === "layer" && action.layerId === layerId);
        if (dance !== undefined && hit?.kind === "layer") out.push({ slot, text: `${where(slot)} is the tap dance ${dance.name}, which ${ACTION_WORD[hit.action]} ${target}` });
      }
    }
  }
  for (const dance of layout.tapDances) {
    const hit = [dance.tap, dance.hold, dance.doubleTap, dance.tapThenHold].some((action) => action?.kind === "layer" && action.layerId === layerId);
    const used = layout.layers.some((layer) => layer.bindings.some((binding) => binding.kind === "tapDance" && binding.tapDanceId === dance.id && layer.id !== layerId));
    if (hit && !used) out.push({ text: `The tap dance ${dance.name} goes to ${target}` });
  }
  for (const combo of layout.combos) {
    const said = describe(combo.output);
    if (said !== null) out.push({ text: `The combo ${combo.name} ${said}` });
    else if (combo.layerIds !== "all" && combo.layerIds.includes(layerId)) out.push({ text: `The combo ${combo.name} is set up on ${target}` });
  }
  return out;
}
