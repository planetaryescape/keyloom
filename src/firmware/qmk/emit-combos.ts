// Combos. QMK names the keycodes to press, not positions, so each position is written as the
// base layer's binding there (05, S3). A combo then fires on any layer where those keycodes are
// what the keys send, which is how the Oryx source behaves and how the importer reads it.
import type { Layout } from "../../layout/schema.ts";
import { type EmitContext, bindingToC } from "./emit-binding.ts";
import { GenerateError } from "./generate-error.ts";

export type Combos = {
  /** Text for keymap.c, or empty when there are no combos. */
  source: string;
  /** Extra `#define`s for config.h. */
  defines: string[];
  count: number;
};

const NOT_A_COMBO_KEY = new Set(["transparent", "none"]);

export function renderCombos(layout: Layout, ctx: EmitContext, passthroughC: string): Combos {
  const combos = layout.combos;
  if (combos.length === 0) return { source: "", defines: [], count: 0 };
  const base = layout.layers[0];
  if (!base) throw new GenerateError("combos need a base layer");

  const wrap = <T>(id: string, fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof GenerateError) throw new GenerateError(`combo "${id}": ${err.message}`);
      throw err;
    }
  };

  const arrays: string[] = [];
  const entries: string[] = [];
  const triggers: string[] = [];
  const terms: string[] = [];
  combos.forEach((combo, i) => {
    wrap(combo.id, () => {
      const keys = combo.positions.map((p) => {
        const b = base.bindings[p];
        if (!b) throw new GenerateError(`position ${p} is not on the board`);
        if (NOT_A_COMBO_KEY.has(b.kind)) throw new GenerateError(`position ${p} is ${b.kind} on the base layer, so it sends no keycode to combine`);
        return bindingToC(b, ctx);
      });
      if (new Set(combo.positions).size !== combo.positions.length) throw new GenerateError("a position appears twice");
      if (combo.output.kind === "holdTap") throw new GenerateError("a combo can't output a hold-tap");
      if (combo.output.kind === "transparent") throw new GenerateError("a combo can't output a transparent key");
      arrays.push(`const uint16_t PROGMEM combo${i}[] = { ${keys.join(", ")}, COMBO_END};`);
      entries.push(`    COMBO(combo${i}, ${bindingToC(combo.output, ctx)}),`);

      if (combo.layerIds !== "all") {
        const checks = combo.layerIds.map((id) => {
          const n = ctx.layerIndex.get(id);
          if (n === undefined) throw new GenerateError(`layer "${id}" doesn't exist`);
          return `layer_state_is(${n})`;
        });
        triggers.push(`    case ${i}: return ${checks.join(" || ")};`);
      }
      if (combo.timeoutMs !== undefined) terms.push(`    case ${i}: return ${combo.timeoutMs};`);
    });
  });

  const defines: string[] = [`COMBO_COUNT ${combos.length}`];
  const parts = [...arrays, "", "combo_t key_combos[COMBO_COUNT] = {", ...entries, "};"];

  const guard = (fn: string) => {
    if (new RegExp(`\\b(?:bool|uint16_t)\\s+${fn}\\s*\\(`).test(passthroughC)) {
      throw new GenerateError(`keymap.c already defines ${fn}, which the combos also need. Remove one of them.`);
    }
  };
  if (triggers.length > 0) {
    guard("combo_should_trigger");
    defines.push("COMBO_SHOULD_TRIGGER");
    parts.push(
      "",
      "bool combo_should_trigger(uint16_t combo_index, combo_t *combo, uint16_t keycode, keyrecord_t *record) {",
      "  switch (combo_index) {",
      ...triggers,
      "  }",
      "  return true;",
      "}",
    );
  }
  if (terms.length > 0) {
    guard("get_combo_term");
    defines.push("COMBO_TERM_PER_COMBO");
    parts.push(
      "",
      "uint16_t get_combo_term(uint16_t combo_index, combo_t *combo) {",
      "  switch (combo_index) {",
      ...terms,
      "  }",
      "  return COMBO_TERM;",
      "}",
    );
  }
  return { source: parts.join("\n"), defines, count: combos.length };
}
