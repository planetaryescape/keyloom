// QMK's two ways to say "when layers A and B are both on, also turn on C" -> ConditionalLayer (D-387):
//  1. `layer_state_set_user` that is only `update_tri_layer_state(state, A, B, C)` calls, which keymap-c.ts hands over as `triLayerCalls`;
//  2. the Tri Layer feature: `TRI_LAYER_ENABLE = yes` in rules.mk, `TRI_LAYER_{LOWER,UPPER,ADJUST}_LAYER` in config.h and the
//     `TL_LOWR` / `TL_UPPR` keys, which hold the lower or upper layer and then update the tri layer.
// Both read the same on the keyboard, so both become the one model. The function and the defines are consumed: the generator writes the
// function itself, with the layers' current numbers, so a reorder cannot leave them behind (the point of layerRefs, D-360).
import type { ConditionalLayer } from "../../layout/schema.ts";
import { newConditionalLayerId } from "../../layout/conditional-layers.ts";
import type { Expr } from "./c-parse.ts";
import { parseDefines } from "./config-h.ts";
import { LAYER_STATE_ANCHOR, type ParsedKeymap } from "./keymap-c.ts";

/** The Tri Layer feature's keycodes, and which of its two layers each one holds. */
export const TRI_LAYER_KEYS = { TL_LOWR: "lower", TL_UPPR: "upper" } as const;
const TRI_LAYER_DEFINES = { TRI_LAYER_LOWER_LAYER: 1, TRI_LAYER_UPPER_LAYER: 2, TRI_LAYER_ADJUST_LAYER: 3 } as const;

export type TriLayerRead = {
  conditionalLayers: ConditionalLayer[];
  /** The kept-chunk anchor of a `layer_state_set_user` that is now modelled. */
  consumedChunks: ReadonlySet<string>;
  /** config.h defines the feature read, which would otherwise be written back pinned to a layer number. */
  consumedDefines: ReadonlySet<string>;
  /** `TL_LOWR` / `TL_UPPR` to the layer they hold; empty unless the feature is read. */
  keys: ReadonlyMap<string, string>;
  warnings: string[];
};

const RULES_YES = /^\s*TRI_LAYER_ENABLE\s*[:?]?=\s*(\S+)/gm;

export function readTriLayers(parsed: ParsedKeymap, layerIds: readonly string[], files: { configH?: string; rulesMk?: string }): TriLayerRead {
  const warnings: string[] = [];
  const found: Array<Pick<ConditionalLayer, "ifLayerIds" | "thenLayerId">> = [];
  const add = (a: string, b: string, c: string) => {
    if (a === b || c === a || c === b) return false;
    if (!found.some((f) => f.thenLayerId === c && f.ifLayerIds.includes(a) && f.ifLayerIds.includes(b))) found.push({ ifLayerIds: [a, b], thenLayerId: c });
    return true;
  };
  const layerOf = (e: Expr | undefined): string | undefined => {
    if (e?.kind === "num") return layerIds[e.value];
    if (e?.kind === "id") return layerIds[parsed.layerNames.indexOf(e.name)];
    return undefined;
  };

  const consumedChunks = new Set<string>();
  const calls = parsed.triLayerCalls?.map((args) => args.map(layerOf));
  // All or nothing: a function that is read in part would have to be kept in part, and C has no half of a function.
  if (calls !== undefined && calls.every((c) => c.every((id) => id !== undefined)) && calls.every((c) => add(c[0] as string, c[1] as string, c[2] as string))) {
    consumedChunks.add(LAYER_STATE_ANCHOR);
  } else if (parsed.triLayerCalls != null) {
    warnings.push("layer_state_set_user kept as written: its update_tri_layer_state calls don't name three different layers keyloom can find");
    found.length = 0;
  }

  const consumedDefines = new Set<string>();
  const keys = new Map<string, string>();
  const usesKeys = parsed.layers.some((layer) => layer.some((e) => e.kind === "id" && e.name in TRI_LAYER_KEYS));
  const enabled = [...(files.rulesMk ?? "").matchAll(RULES_YES)].at(-1)?.[1] === "yes";
  if (usesKeys && enabled) {
    const defines = new Map(parseDefines(files.configH ?? "").defines.map((d) => [d.name, d.value]));
    const index = (name: keyof typeof TRI_LAYER_DEFINES): number => {
      const written = defines.get(name);
      return written === undefined ? TRI_LAYER_DEFINES[name] : /^\d+$/.test(written) ? Number(written) : -1;
    };
    const [lower, upper, adjust] = (["TRI_LAYER_LOWER_LAYER", "TRI_LAYER_UPPER_LAYER", "TRI_LAYER_ADJUST_LAYER"] as const).map((n) => layerIds[index(n)]);
    if (lower !== undefined && upper !== undefined && adjust !== undefined && add(lower, upper, adjust)) {
      keys.set("TL_LOWR", lower).set("TL_UPPR", upper);
      warnings.push("TL_LOWR and TL_UPPR were read as keys that hold the lower and upper layer; the condition now holds however those layers are turned on, not only through those two keys");
      for (const name of Object.keys(TRI_LAYER_DEFINES)) if (defines.has(name)) consumedDefines.add(name);
    } else warnings.push("the Tri Layer feature is on, but TRI_LAYER_*_LAYER don't name three different layers; its keys are kept as written");
  }

  const taken = { conditionalLayers: [] as ConditionalLayer[] };
  for (const f of found) taken.conditionalLayers.push({ id: newConditionalLayerId(taken, f.thenLayerId), ...f });
  return { conditionalLayers: taken.conditionalLayers, consumedChunks, consumedDefines, keys, warnings };
}
