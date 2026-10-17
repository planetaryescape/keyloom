// Conditional layers (D-385): "when layers A and B are both on, also turn on C". Pure, like the rest of validation.
import { conditionalLayerName, conditionProblem } from "../layout/conditional-layers.ts";
import type { Layout } from "../layout/schema.ts";
import type { Issue } from "./result.ts";
import { layerName } from "./words.ts";

const issue = (code: string, message: string, plain: string): Issue => ({ code, message, plain });

/** The anchor the QMK importer gives a kept `layer_state_set_user`; the generator writes its own when the layout has conditions. */
export const QMK_LAYER_STATE_ANCHOR = "function:layer_state_set_user";

/**
 * `unknown_ref` for a condition that names a layer the layout hasn't got, `conditional_layer_invalid` for one that can never
 * work (the same layer twice, or the layer it turns on being one it waits for), and `conditional_layer_blocked` for a QMK layout
 * whose kept code already defines `layer_state_set_user`, which the generated one would define a second time.
 */
export function conditionalLayerRules(doc: Layout): Issue[] {
  const known = new Set(doc.layers.map((l) => l.id));
  const out: Issue[] = [];
  for (const c of doc.conditionalLayers) {
    const missing = [...c.ifLayerIds, c.thenLayerId].filter((id) => !known.has(id));
    if (missing.length > 0) {
      out.push(issue("unknown_ref", `conditional layer "${c.id}" refers to layer "${missing[0]}", which does not exist`,
        "A condition that turns a layer on points at a layer that isn't in this layout. Remove the condition, or pick the layer again."));
      continue;
    }
    const problem = conditionProblem(doc, c);
    if (problem !== null) {
      out.push(issue("conditional_layer_invalid", `conditional layer "${c.id}": ${problem}`,
        `"${conditionalLayerName(doc, c)}" can't work: ${problem}.`));
    }
  }
  if (doc.firmware === "qmk" && doc.conditionalLayers.length > 0 && doc.passthrough.some((p) => p.firmware === "qmk" && p.file === "keymap.c" && p.anchor === QMK_LAYER_STATE_ANCHOR)) {
    out.push(issue("conditional_layer_blocked", "keymap.c keeps its own layer_state_set_user, so keyloom can't write one for the conditional layers beside it",
      "Your custom code already decides what happens when layers change, so keyloom can't add conditional layers beside it."));
  }
  return out;
}

/**
 * Advice rather than an error: kanata keeps one active layer (a stack of held layers, and `(layer x)` in a `switch` asks only about the
 * top one), so "when two layers are both held" has nothing to be written as. The conditions stay in the layout and are left out of
 * the config, with a comment saying so (D-388).
 */
export function conditionalLayerWarnings(doc: Layout): Issue[] {
  if (doc.firmware !== "kanata") return [];
  return doc.conditionalLayers.map((c) => issue("conditional_layer_unsupported", `conditional layer "${c.id}" is not written: kanata has one active layer at a time, so it can't turn a layer on while two others are held`,
    `${layerName(doc, c.thenLayerId)} will not turn on when ${layerName(doc, c.ifLayerIds[0] as string)} and ${layerName(doc, c.ifLayerIds[1] as string)} are held: the MacBook's remapper only has one layer active at a time, so this condition is left out of its config.`));
}
