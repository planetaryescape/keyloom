// TapDance -> the C Oryx generates for a tap dance: an `on_dance_n`, `dance_n_finished` and
// `dance_n_reset` per entry around one shared `dance_step`, in `tap_dance_actions[]` (16#tap-dance-is-a-key-with-a-double-tap-slot).
// The importer (import-tap-dance.ts) reads Oryx's source by regenerating it from the model and comparing,
// so this output has to stay in Oryx's shape: any drift makes BK's tap dances import as opaque native keys again.
import type { Macro, SlotAction, TapDance } from "../../layout/schema.ts";
import { type EmitContext, bindingToC } from "./emit-binding.ts";
import { macroBody } from "./emit-macros.ts";
import { GenerateError } from "./generate-error.ts";

/** What a slot does when it fires (`down`), when the key comes up (`up`) and when it is tapped without the dance (`tap`). */
type SlotC = { down: string[]; up: string[]; tap: string[] };

function slotC(a: SlotAction, ctx: EmitContext, macros: ReadonlyMap<string, Macro>): SlotC {
  switch (a.kind) {
    case "key":
    case "modifier": {
      const expr = bindingToC(a, ctx);
      return { down: [`register_code16(${expr});`], up: [`unregister_code16(${expr});`], tap: [`tap_code16(${expr});`] };
    }
    case "macro": {
      const macro = macros.get(a.macroId);
      if (!macro) throw new GenerateError(`it uses the macro "${a.macroId}", which doesn't exist`);
      const send = `SEND_STRING(${macroBody(macro)});`;
      return { down: [send], up: [], tap: [send] };
    }
    case "layer": {
      const index = ctx.layerIndex.get(a.layerId);
      if (index === undefined) throw new GenerateError(`it refers to layer "${a.layerId}", which doesn't exist`);
      switch (a.action) {
        case "momentary": return { down: [`layer_on(${index});`], up: [`layer_off(${index});`], tap: [`layer_on(${index});`, `layer_off(${index});`] };
        case "toggle": return { down: [`layer_invert(${index});`], up: [], tap: [`layer_invert(${index});`] };
        case "to": return { down: [`layer_move(${index});`], up: [], tap: [`layer_move(${index});`] };
        case "oneShot": {
          const start = `set_oneshot_layer(${index}, ONESHOT_START);`;
          const end = "clear_oneshot_layer_state(ONESHOT_PRESSED);";
          return { down: [start], up: [end], tap: [start, end] };
        }
      }
    }
  }
}

/** Oryx's name for the state each slot fires in. */
const STATES = [
  ["SINGLE_TAP", "tap"],
  ["SINGLE_HOLD", "hold"],
  ["DOUBLE_TAP", "doubleTap"],
  ["DOUBLE_HOLD", "tapThenHold"],
] as const;

const HEAD = `typedef struct {
    bool is_press_action;
    uint8_t step;
} tap;

enum {
    SINGLE_TAP = 1,
    SINGLE_HOLD,
    DOUBLE_TAP,
    DOUBLE_HOLD,
    DOUBLE_SINGLE_TAP,
    MORE_TAPS
};`;

const STEP = `uint8_t dance_step(tap_dance_state_t *state);

uint8_t dance_step(tap_dance_state_t *state) {
    if (state->count == 1) {
        if (state->interrupted || !state->pressed) return SINGLE_TAP;
        else return SINGLE_HOLD;
    } else if (state->count == 2) {
        if (state->interrupted) return DOUBLE_SINGLE_TAP;
        else if (state->pressed) return DOUBLE_HOLD;
        else return DOUBLE_TAP;
    }
    return MORE_TAPS;
}`;

function danceFunctions(td: TapDance, n: number, ctx: EmitContext, macros: ReadonlyMap<string, Macro>): string {
  const slots = new Map<string, SlotC>();
  try {
    for (const [state, name] of STATES) {
      const a = td[name];
      if (a) slots.set(state, slotC(a, ctx, macros));
    }
  } catch (err) {
    if (err instanceof GenerateError) throw new GenerateError(`tap dance "${td.name}": ${err.message}`);
    throw err;
  }
  const tap = slots.get("SINGLE_TAP") as SlotC;
  const taps = (count: number) => Array.from({ length: count }, () => tap.tap.map((l) => `        ${l}`)).flat();
  const finished = [...slots].map(([state, c]) => `        case ${state}: ${c.down.join(" ")} break;`);
  // The tapped-twice-in-a-hurry case: the tap, then the tap held, so two quick taps of a key type twice.
  finished.push(`        case DOUBLE_SINGLE_TAP: ${[...tap.tap, ...tap.down].join(" ")}`);
  const reset = [...slots, ["DOUBLE_SINGLE_TAP", tap] as const]
    .filter(([, c]) => c.up.length > 0)
    .map(([state, c]) => `        case ${state}: ${c.up.join(" ")} break;`);
  return [
    `void on_dance_${n}(tap_dance_state_t *state, void *user_data);`,
    `void dance_${n}_finished(tap_dance_state_t *state, void *user_data);`,
    `void dance_${n}_reset(tap_dance_state_t *state, void *user_data);`,
    "",
    `void on_dance_${n}(tap_dance_state_t *state, void *user_data) {`,
    "    if(state->count == 3) {",
    ...taps(3),
    "    }",
    "    if(state->count > 3) {",
    ...taps(1),
    "    }",
    "}",
    "",
    `void dance_${n}_finished(tap_dance_state_t *state, void *user_data) {`,
    `    dance_state[${n}].step = dance_step(state);`,
    `    switch (dance_state[${n}].step) {`,
    ...finished,
    "    }",
    "}",
    "",
    `void dance_${n}_reset(tap_dance_state_t *state, void *user_data) {`,
    "    wait_ms(10);",
    `    switch (dance_state[${n}].step) {`,
    ...reset,
    "    }",
    `    dance_state[${n}].step = 0;`,
    "}",
  ].join("\n");
}

export const danceEnumName = (index: number): string => `DANCE_${index}`;

export type RenderedTapDances = {
  /** `enum tap_dance_codes`, which the keymap's TD() uses, so it goes before keymaps[]. */
  codes: string;
  /** Everything else, which goes after keymaps[]. */
  code: string;
};

/** The C for every tap dance, or undefined when the layout has none. */
export function renderTapDances(tapDances: readonly TapDance[], macros: readonly Macro[], ctx: EmitContext): RenderedTapDances | undefined {
  if (tapDances.length === 0) return undefined;
  const byId = new Map(macros.map((m) => [m.id, m]));
  const codes = `enum tap_dance_codes {\n${tapDances.map((_, i) => `  ${danceEnumName(i)},`).join("\n")}\n};`;
  const code = [
    HEAD,
    "",
    `static tap dance_state[${tapDances.length}];`,
    "",
    STEP,
    "",
    "",
    tapDances.map((td, i) => danceFunctions(td, i, ctx, byId)).join("\n"),
    "",
    "tap_dance_action_t tap_dance_actions[] = {",
    ...tapDances.map((_, i) => `        [${danceEnumName(i)}] = ACTION_TAP_DANCE_FN_ADVANCED(on_dance_${i}, dance_${i}_finished, dance_${i}_reset),`),
    "};",
  ].join("\n");
  return { codes, code };
}
