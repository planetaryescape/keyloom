// Ops that put `code` on a key of BK's imported Moonlander layout. A plain setBinding loses whatever the
// key did (function_lost, D-020), so these first drop it. Tests that edit a key more than once also
// drop the codes earlier edits wrote: dropping a function that isn't there is harmless.
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { FIXTURE_DIR, moonlander } from "./board.ts";

const { layout } = await importOryxSource(FIXTURE_DIR, (await moonlander()).definition);
const EARLIER_EDITS = ["F5", "F17", "F18", "F19"];

export const dropFunctions = (fns: string[]): ChangeOp[] => fns.map((function_) => ({ op: "dropFunction", function: function_, reason: "test edit" }));

export function setKey(position: number, code: string, layerId = "layer-0"): ChangeOp[] {
  const old = layout.layers.find((l) => l.id === layerId)?.bindings[position];
  const lost = [...(old ? bindingFunctions(old, layout.tapDances) : []), ...EARLIER_EDITS.map((c) => `key:${c}`)];
  return [...dropFunctions(lost), { op: "setBinding", at: { layerId, position }, binding: { kind: "key", code } }];
}

const POSITIONS: Record<string, [number, number]> = {
  fn: [2, 3],
  extra: [0, 3],
  symbols: [2, 3],
  navigation: [1, 2],
  "layer-6": [2, 3],
  "layer-7": [1, 2],
  "layer-8": [1, 3],
};

/** A new layer with a combo that reaches it, so adding it doesn't strand it (layer_unreachable). */
export const addReachableLayer = (id: string, afterLayerId: string, positions?: [number, number]): ChangeOp[] => [
  { op: "addLayer", layer: { id, name: id }, afterLayerId },
  { op: "upsertCombo", combo: { id: `go-${id}`, name: id, positions: positions ?? POSITIONS[id] ?? [2, 3], layerIds: "all", output: { kind: "layer", action: "momentary", layerId: id } } },
];

/** The decision draft the agent attaches to a proposal (08): the words to remember if BK applies it. */
export const draft = (over: Partial<{ goal: string; choice: string; reason: string; scope: { apps: string[]; habits: string[] } }> = {}) => ({
  goal: "Test goal", choice: "Test choice", reason: "Test reason", scope: { apps: [], habits: [] }, ...over,
});
