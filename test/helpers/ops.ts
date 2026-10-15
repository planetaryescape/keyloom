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
  const lost = [...(old ? bindingFunctions(old) : []), ...EARLIER_EDITS.map((c) => `key:${c}`)];
  return [...dropFunctions(lost), { op: "setBinding", at: { layerId, position }, binding: { kind: "key", code } }];
}

/** A new layer with a combo that reaches it, so adding it doesn't strand it (layer_unreachable). */
export const addReachableLayer = (id: string, afterLayerId: string): ChangeOp[] => [
  { op: "addLayer", layer: { id, name: id }, afterLayerId },
  { op: "upsertCombo", combo: { id: `go-${id}`, name: id, positions: [0, 1], layerIds: "all", output: { kind: "layer", action: "momentary", layerId: id } } },
];
