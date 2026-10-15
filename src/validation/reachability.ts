// The layer graph and the function sets built on it (07#reachability). Pure analysis over one
// document; the rules in rules.ts compare the answers for the layout before and after a change.
import type { Slot } from "../layout/change.ts";
import { bindingFunctions } from "../layout/functions.ts";
import type { Binding, Layout } from "../layout/schema.ts";

export type LayerAction = "momentary" | "toggle" | "to" | "oneShot";

/** One way to get to layer `to` while `from` is active. A combo edge has `comboId`, a key edge has `slot`. */
export type LayerEdge = { from: string; to: string; action: LayerAction; slot?: Slot; comboId?: string };

// QMK's layer macros and what they do, for native bindings (D-024: keyloom keeps source it doesn't model).
// They name layers by index, the same pinning passthrough_layer_index guards.
const QMK_LAYER_MACROS: Record<string, LayerAction> = { MO: "momentary", LT: "momentary", TT: "momentary", OSL: "oneShot", TG: "toggle", TO: "to", DF: "to" };

/**
 * A native binding's QMK layer macro, looking through one `#define NAME ...` kept in a passthrough
 * block (Oryx writes a layer-tap with a dual function as `#define DUAL_FUNC_0 LT(5, KC_4)`). Without this,
 * the layer only that key reaches would look unreachable on a layout where it works.
 */
function nativeLayerTarget(b: Extract<Binding, { kind: "native" }>, doc: Layout): { layerId: string; action: LayerAction } | undefined {
  if (b.firmware === "zmk") return zmkLayerTarget(b.source, doc);
  if (b.firmware !== "qmk") return undefined;
  const define = !/^\w+$/.test(b.source) ? undefined : doc.passthrough.map((p) => new RegExp(`^\\s*#define\\s+${b.source}\\s+(.+?)\\s*$`, "m").exec(p.source)?.[1]).find((v) => v !== undefined);
  const m = /^(MO|LT|TT|OSL|TG|TO|DF)\(\s*(\d+)\s*[,)]/.exec(define ?? b.source);
  const layerId = m ? doc.layers[Number(m[2])]?.id : undefined;
  return m && layerId ? { layerId, action: QMK_LAYER_MACROS[m[1] as string] as LayerAction } : undefined;
}

// ZMK's built-in layer behaviours and which parameter names the layer.
const ZMK_LAYER_BEHAVIORS: Record<string, LayerAction> = { mo: "momentary", lt: "momentary", sl: "oneShot", tog: "toggle", to: "to" };

/** A layer index, written as a number or as a name `#define`d to one in a kept block (the template's `#define LOWER 1`). */
function zmkLayerIndex(param: string | undefined, doc: Layout): number | undefined {
  if (param === undefined) return undefined;
  if (/^\d+$/.test(param)) return Number(param);
  if (!/^\w+$/.test(param)) return undefined;
  const value = doc.passthrough.map((p) => new RegExp(`^\\s*#define\\s+${param}\\s+(\\d+)\\s*$`, "m").exec(p.source)?.[1]).find((v) => v !== undefined);
  return value === undefined ? undefined : Number(value);
}

/**
 * A native ZMK binding's layer switch: a built-in layer behaviour, or a custom behaviour kept as
 * written whose definition switches layers. The Glove80 template reaches Lower only through the
 * tap-dance `layer_td` (`bindings = <&mo LOWER>, <&to LOWER>`) and Magic only through the hold-tap
 * `magic` (`bindings = <&mo>, ...`, so `&magic MAGIC 0` holds MAGIC). Without this, those layers
 * looked unreachable on a working layout.
 */
function zmkLayerTarget(source: string, doc: Layout, depth = 0): { layerId: string; action: LayerAction } | undefined {
  const [ref, ...params] = source.trim().split(/\s+/);
  const name = ref?.replace(/^&/, "");
  if (!name || !/^\w+$/.test(name) || depth > 2) return undefined;
  const builtin = ZMK_LAYER_BEHAVIORS[name];
  if (builtin) {
    const layerId = doc.layers[zmkLayerIndex(params[0], doc) ?? -1]?.id;
    return layerId ? { layerId, action: builtin } : undefined;
  }
  const block = doc.passthrough.find((p) => new RegExp(`^\\s*${name}\\s*:`).test(p.source))?.source;
  const bindings = block === undefined ? undefined : /bindings\s*=\s*([^;]+);/.exec(block)?.[1];
  if (bindings === undefined) return undefined;
  const calls = [...bindings.matchAll(/<([^>]*)>/g)].map((m) => (m[1] ?? "").trim());
  if (/zmk,behavior-hold-tap/.test(block ?? "")) {
    // A hold-tap's bindings name behaviours only; the call's first parameter goes to the hold one.
    const hold = calls[0]?.replace(/^&/, "");
    const action = hold === undefined ? undefined : ZMK_LAYER_BEHAVIORS[hold];
    const layerId = action === undefined ? undefined : doc.layers[zmkLayerIndex(params[0], doc) ?? -1]?.id;
    return action && layerId ? { layerId, action: "momentary" } : undefined;
  }
  // A tap-dance (or similar) lists whole calls; the first that switches layers counts.
  for (const call of calls) {
    const target = zmkLayerTarget(call, doc, depth + 1);
    if (target) return target;
  }
  return undefined;
}

/** The layer a binding switches to, if it does. A layer-tap's hold is a momentary layer (its tap is a plain key). */
export function layerTarget(b: Binding, doc: Layout): { layerId: string; action: LayerAction } | undefined {
  if (b.kind === "layer") return { layerId: b.layerId, action: b.action };
  if (b.kind === "holdTap" && "layerId" in b.hold) return { layerId: b.hold.layerId, action: "momentary" };
  if (b.kind === "native") return nativeLayerTarget(b, doc);
  return undefined;
}

/** The base layer is the first one: the firmware's default layer, and the bottom of every fall-through. */
const baseId = (doc: Layout) => doc.layers[0]?.id;

/** Layers a combo is live on. Ids the document doesn't have are dropped; unknown_ref reports them. */
function comboLayers(doc: Layout, layerIds: "all" | string[]): string[] {
  const known = new Set(doc.layers.map((l) => l.id));
  return (layerIds === "all" ? [...known] : layerIds).filter((id) => known.has(id));
}

/** Every layer-switching binding, as an edge from each layer it is live on. Edges to layers that don't exist are skipped. */
export function layerGraph(doc: Layout): LayerEdge[] {
  const known = new Set(doc.layers.map((l) => l.id));
  const edges: LayerEdge[] = [];
  for (const layer of doc.layers) {
    for (const [position, b] of layer.bindings.entries()) {
      const t = layerTarget(b, doc);
      if (t && known.has(t.layerId)) edges.push({ from: layer.id, to: t.layerId, action: t.action, slot: { layerId: layer.id, position } });
    }
  }
  for (const combo of doc.combos) {
    const t = layerTarget(combo.output, doc);
    if (!t || !known.has(t.layerId)) continue;
    for (const from of comboLayers(doc, combo.layerIds)) edges.push({ from, to: t.layerId, action: t.action, comboId: combo.id });
  }
  return edges;
}

/** The layers the base layer can get to, base included. */
export function reachableLayers(doc: Layout, edges: LayerEdge[] = layerGraph(doc)): Set<string> {
  const base = baseId(doc);
  const seen = new Set<string>(base ? [base] : []);
  const queue = [...seen];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const e of edges) {
      if (e.from === id && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return seen;
}

/**
 * What a key does on a layer, following `transparent` the way QMK and ZMK do: a transparent key
 * defers to the same position on the next lower active layer, and the base layer is always active
 * and is the end of the line (a transparent key there does nothing). Both firmwares order active
 * layers by index, not by activation order, so "lower" means a lower index.
 *
 * Which layers besides the base are active depends on how the layer was entered, so the caller says:
 * `isActive` defaults to "only the base", the one layer guaranteed to be beneath. Undefined means
 * the key does nothing.
 */
export function resolveBinding(doc: Layout, layerIndex: number, position: number, isActive: (layerId: string) => boolean = () => false): Binding | undefined {
  for (let i = layerIndex; i >= 0; i--) {
    const layer = doc.layers[i];
    if (!layer) return undefined;
    if (i !== layerIndex && i !== 0 && !isActive(layer.id)) continue;
    const b = layer.bindings[position];
    if (b && b.kind !== "transparent") return b;
  }
  return undefined;
}

/**
 * Where each reachable function lives: the slots holding it on reachable layers. Combo outputs are
 * functions with no slot, present when the combo is live on a reachable layer.
 *
 * `transparent` adds nothing here. It defers only to layers beneath it that are active, an active
 * layer is a reachable one, and the bindings of every reachable layer are already counted. So the
 * set is the physical bindings; `resolveBinding` is for asking what a key does, not what exists.
 */
export function functionHomes(doc: Layout, reachable: Set<string> = reachableLayers(doc)): Map<string, Slot[]> {
  const homes = new Map<string, Slot[]>();
  const add = (fn: string, slot?: Slot) => {
    const at = homes.get(fn) ?? [];
    if (slot) at.push(slot);
    homes.set(fn, at);
  };
  for (const layer of doc.layers) {
    if (!reachable.has(layer.id)) continue;
    for (const [position, b] of layer.bindings.entries()) for (const fn of bindingFunctions(b)) add(fn, { layerId: layer.id, position });
  }
  for (const combo of doc.combos) {
    if (comboLayers(doc, combo.layerIds).some((id) => reachable.has(id))) for (const fn of bindingFunctions(combo.output)) add(fn);
  }
  return homes;
}

const slotKey = (s: Slot) => `${s.layerId}:${s.position}`;

/** Functions reachable before and not after, with the slots that held them. */
export function lostFunctions(before: Map<string, Slot[]>, after: Map<string, Slot[]>): { function: string; was: Slot[] }[] {
  return [...before].filter(([fn]) => !after.has(fn)).map(([fn, was]) => ({ function: fn, was }));
}

/** Functions in both sets that vacated a slot they held: the ones BK has to learn a new place for. */
export function relearned(before: Map<string, Slot[]>, after: Map<string, Slot[]>): number {
  let count = 0;
  for (const [fn, was] of before) {
    const now = after.get(fn);
    if (!now) continue;
    const kept = new Set(now.map(slotKey));
    if (was.some((s) => !kept.has(slotKey(s)))) count++;
  }
  return count;
}

/**
 * For each changed slot, the functions it used to hold that it no longer does, with where they
 * live now (null when nowhere). A new home among the changed slots wins over an old copy elsewhere:
 * that is where the move put it.
 */
export function displacedFunctions(before: Layout, after: Layout, changed: Slot[], beforeHomes: Map<string, Slot[]>, afterHomes: Map<string, Slot[]>) {
  const changedKeys = new Set(changed.map(slotKey));
  const out: { function: string; from: Slot; to: Slot | null }[] = [];
  for (const from of changed) {
    const was = before.layers.find((l) => l.id === from.layerId)?.bindings[from.position];
    const now = after.layers.find((l) => l.id === from.layerId)?.bindings[from.position];
    if (!was) continue;
    const kept = now ? bindingFunctions(now) : [];
    for (const fn of bindingFunctions(was)) {
      if (kept.includes(fn) || !beforeHomes.has(fn)) continue;
      const homes = (afterHomes.get(fn) ?? []).filter((s) => slotKey(s) !== slotKey(from));
      out.push({ function: fn, from, to: homes.find((s) => changedKeys.has(slotKey(s))) ?? homes[0] ?? null });
    }
  }
  return out;
}

/**
 * Layers that can be reached but not left. Strict reading of 07's `layer_trap`: a layer entered by
 * `toggle` or `to` stays put until a key says otherwise, so it needs a key that leads back to the
 * base, directly or through other such layers. Momentary and one-shot layers end when the key is
 * released or used, so they never trap.
 *
 * "A key" means what the key does on that layer, so `transparent` counts as the base layer's key
 * beneath it (the usual way to put a layer's toggle key on the layer itself). Only the base is
 * assumed to be beneath, because `to` switches every other layer off.
 */
export function trappedLayers(doc: Layout, edges: LayerEdge[] = layerGraph(doc), reachable: Set<string> = reachableLayers(doc, edges)): { layerId: string; entered: LayerEdge[] }[] {
  const base = baseId(doc);
  const exits = new Map<string, { layerId: string; action: LayerAction }[]>();
  const note = (layerId: string, b: Binding | undefined) => {
    const t = b && layerTarget(b, doc);
    if (t) exits.set(layerId, [...(exits.get(layerId) ?? []), t]);
  };
  for (const [index, layer] of doc.layers.entries()) {
    for (let position = 0; position < layer.bindings.length; position++) note(layer.id, resolveBinding(doc, index, position));
  }
  for (const combo of doc.combos) for (const id of comboLayers(doc, combo.layerIds)) note(id, combo.output);

  // A layer can be left if it is the base, toggles itself off, or sends `to` a layer that can be left.
  const free = new Set<string>(base ? [base] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const layer of doc.layers) {
      if (free.has(layer.id)) continue;
      const back = (exits.get(layer.id) ?? []).some((e) => (e.action === "toggle" && e.layerId === layer.id) || (e.action === "to" && free.has(e.layerId)));
      if (back) {
        free.add(layer.id);
        grew = true;
      }
    }
  }
  return doc.layers
    .filter((l) => reachable.has(l.id) && !free.has(l.id))
    .map((l) => ({ layerId: l.id, entered: edges.filter((e) => e.to === l.id && reachable.has(e.from) && (e.action === "toggle" || e.action === "to")) }))
    .filter((t) => t.entered.length > 0);
}
