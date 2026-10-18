// What differs between two documents of one config (25, D-301): the per-key changes the board can draw, and the rest of the
// document as names. It is what "compare with now" shows and what going back would undo, so it reads documents, not change sets.
import { conditionalLayerName } from "./conditional-layers.ts";
import { deepEqual } from "./equal.ts";
import type { Binding, Layout } from "./schema.ts";

export type KeyDiff = { layerId: string; layerName: string; position: number; before: Binding; after: Binding };

export type NamedChange = { added: string[]; removed: string[]; changed: string[] };

export type LayoutDiff = {
  /** Keys whose binding differs, on layers both documents have, in the `to` document's layer order. */
  keys: KeyDiff[];
  layersAdded: Array<{ id: string; name: string }>;
  layersRemoved: Array<{ id: string; name: string }>;
  layersRenamed: Array<{ id: string; from: string; to: string }>;
  /** The layers both documents have are in a different order. */
  layersReordered: boolean;
  /** Layers whose per-key LED colours differ. */
  lighting: string[];
  macros: NamedChange;
  tapDances: NamedChange;
  combos: NamedChange;
  /** Conditions named by their layers, such as "Lower + Raise gives Adjust". */
  conditionalLayers: NamedChange;
  holdTapProfiles: NamedChange;
  settings: Array<{ firmware: string; key: string; before: string | number | boolean | null; after: string | number | boolean | null }>;
  /** Firmware source kept as written differs. */
  passthrough: boolean;
  /** True when nothing differs: the two documents are the same. */
  same: boolean;
};

type Named = { id: string; name: string };

function namedChange<T extends Named>(from: readonly T[], to: readonly T[]): NamedChange {
  const before = new Map(from.map((x) => [x.id, x]));
  const after = new Map(to.map((x) => [x.id, x]));
  return {
    added: to.filter((x) => !before.has(x.id)).map((x) => x.name),
    removed: from.filter((x) => !after.has(x.id)).map((x) => x.name),
    changed: to.filter((x) => {
      const b = before.get(x.id);
      return b !== undefined && !deepEqual(b, x);
    }).map((x) => x.name),
  };
}

/** A condition has no name of its own; its layers' names say it. Added and removed go by id; changed means the same id now does something else. */
function conditionalChange(from: Layout, to: Layout): NamedChange {
  const named = (doc: Layout) => doc.conditionalLayers.map((c) => ({ ...c, name: conditionalLayerName(doc, c) }));
  const change = namedChange(named(from), named(to));
  const was = new Map(from.conditionalLayers.map((c) => [c.id, c]));
  return {
    added: change.added,
    removed: change.removed,
    changed: to.conditionalLayers.filter((c) => was.has(c.id) && !deepEqual(was.get(c.id), c)).map((c) => conditionalLayerName(to, c)),
  };
}

export function diffLayouts(from: Layout, to: Layout): LayoutDiff {
  const fromLayers = new Map(from.layers.map((l) => [l.id, l]));
  const toLayers = new Map(to.layers.map((l) => [l.id, l]));
  const keys: KeyDiff[] = [];
  const lighting: string[] = [];
  const layersRenamed: LayoutDiff["layersRenamed"] = [];
  for (const layer of to.layers) {
    const was = fromLayers.get(layer.id);
    if (!was) continue;
    if (was.name !== layer.name) layersRenamed.push({ id: layer.id, from: was.name, to: layer.name });
    if (!deepEqual(was.lighting, layer.lighting)) lighting.push(layer.id);
    const length = Math.max(was.bindings.length, layer.bindings.length);
    for (let position = 0; position < length; position++) {
      const before = was.bindings[position];
      const after = layer.bindings[position];
      // A board's layers all have its key count; a document with a short layer is invalid, so a missing key reads as no binding.
      const b = before ?? { kind: "none" as const };
      const a = after ?? { kind: "none" as const };
      if (!deepEqual(b, a)) keys.push({ layerId: layer.id, layerName: layer.name, position, before: b, after: a });
    }
  }
  const shared = (layers: Layout["layers"], other: Map<string, unknown>) => layers.filter((l) => other.has(l.id)).map((l) => l.id);
  const layersReordered = !deepEqual(shared(from.layers, toLayers), shared(to.layers, fromLayers));

  const settingKey = (s: Layout["settings"][number]) => `${s.firmware}:${s.key}`;
  const was = new Map(from.settings.map((s) => [settingKey(s), s]));
  const now = new Map(to.settings.map((s) => [settingKey(s), s]));
  const settings: LayoutDiff["settings"] = [];
  for (const k of new Set([...was.keys(), ...now.keys()])) {
    const b = was.get(k);
    const a = now.get(k);
    if (!deepEqual(b?.value, a?.value)) settings.push({ firmware: (a ?? b)!.firmware, key: (a ?? b)!.key, before: b?.value ?? null, after: a?.value ?? null });
  }

  const diff: Omit<LayoutDiff, "same"> = {
    keys,
    layersAdded: to.layers.filter((l) => !fromLayers.has(l.id)).map((l) => ({ id: l.id, name: l.name })),
    layersRemoved: from.layers.filter((l) => !toLayers.has(l.id)).map((l) => ({ id: l.id, name: l.name })),
    layersRenamed, layersReordered, lighting,
    macros: namedChange(from.macros, to.macros),
    tapDances: namedChange(from.tapDances, to.tapDances),
    combos: namedChange(from.combos, to.combos),
    conditionalLayers: conditionalChange(from, to),
    holdTapProfiles: namedChange(from.holdTapProfiles, to.holdTapProfiles),
    settings,
    passthrough: !deepEqual(from.passthrough, to.passthrough),
  };
  return { ...diff, same: deepEqual(from, to) };
}
