// Conditional layers -> `layer_state_set_user` (D-387). QMK calls it whenever the layer state changes, and `update_tri_layer_state`
// turns the third layer on while the first two are, and off when they aren't. Each condition is one statement, in the layout's order.
import type { Layout } from "../../layout/schema.ts";
import type { EmitContext } from "./emit-binding.ts";
import { GenerateError } from "./generate-error.ts";

export function renderLayerState(layout: Layout, ctx: EmitContext): string | undefined {
  if (layout.conditionalLayers.length === 0) return undefined;
  const index = (c: string, id: string): number => {
    const i = ctx.layerIndex.get(id);
    if (i === undefined) throw new GenerateError(`conditional layer "${c}" names layer "${id}", which doesn't exist`);
    return i;
  };
  const statements = layout.conditionalLayers.map((c) => {
    const [a, b] = c.ifLayerIds.map((id) => index(c.id, id)) as [number, number];
    const then = index(c.id, c.thenLayerId);
    if (new Set([a, b, then]).size !== 3) throw new GenerateError(`conditional layer "${c.id}" must name three different layers`);
    return `  state = update_tri_layer_state(state, ${a}, ${b}, ${then});`;
  });
  return ["layer_state_t layer_state_set_user(layer_state_t state) {", ...statements, "  return state;", "}"].join("\n");
}
