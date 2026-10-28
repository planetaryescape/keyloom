// Reads what a native binding does from its source: QMK keycodes, ZMK builtins, and ZMK behaviours or macros keyloom kept as
// written, resolved through the layout's own kept definitions (kept-behaviours.ts). A hold-tap that holds a momentary layer (MoErgo's
// magic) reads as that layer, identified by the binding's layerRefs rather than the number in its text. Anything else is unknown,
// and stays a skip. Pure.
import { type KeptCall, type KeptDefinition, parseCalls } from "./kept-behaviours.ts";
import { MOD_ORDER, type LightingOp, type Reading, type Step } from "./native-meaning.ts";
import type { LayerRef, Mod } from "./schema.ts";

export type NativeSource = { firmware: "qmk" | "zmk" | "kanata"; source: string; layerRefs?: readonly LayerRef[] | undefined };
export type KeptMap = ReadonlyMap<string, KeptDefinition | null>;

const MAX_DEPTH = 4;
const HOLD_TAP = "zmk,behavior-hold-tap";
const STICKY_KEY = "zmk,behavior-sticky-key";
const MACRO = "zmk,behavior-macro";
// A macro's controls set how the steps after them run (tap, press or release), pause for a release, or set the timing of the steps after
// them. None presses anything itself, so a step after one still reads as a step of the macro (ZMK's handle_control_binding,
// moergo-sc/zmk app/src/behaviors/behavior_macro.c @ ce69e85). The timing controls take one number; any other shape is not skipped.
const MACRO_CONTROLS = new Set(["macro_tap", "macro_press", "macro_release", "macro_pause_for_release"]);
const MACRO_TIMING = new Set(["macro_wait_time", "macro_tap_time"]);

// The one-shot's mods as QMK writes them: `OSM(MOD_LSFT)`, `OSM(MOD_LCTL|MOD_LALT)`. Whole-string, so `OSM(MOD_L SFT)` and `OSM(MOD_LSFT) ` do not read.
const QMK_OSM = /^OSM\((MOD_[LR](?:CTL|SFT|ALT|GUI)(?:\|MOD_[LR](?:CTL|SFT|ALT|GUI))*)\)$/;
// A ZMK binding's whole source: one `&name` and its parameters, separated by single spaces. Text before the `&` does not read.
const ZMK_CALL = /^&[A-Za-z_]\w*(?: [^\s&]+)*$/;

const QMK_STEPS = new Map<string, Step>([
  ["CW_TOGG", { kind: "capsWord" }], ["QK_CAPS_WORD_TOGGLE", { kind: "capsWord" }],
  ["QK_BOOT", { kind: "bootloader" }], ["QK_REBOOT", { kind: "reset" }],
  ["RGB_TOG", { kind: "lighting", op: "toggle" }],
  ["RGB_HUI", { kind: "lighting", op: "hueUp" }], ["RGB_HUD", { kind: "lighting", op: "hueDown" }],
  ["RGB_SAI", { kind: "lighting", op: "satUp" }], ["RGB_SAD", { kind: "lighting", op: "satDown" }],
  ["RGB_VAI", { kind: "lighting", op: "briUp" }], ["RGB_VAD", { kind: "lighting", op: "briDown" }],
  ["RGB_SPI", { kind: "lighting", op: "speedUp" }], ["RGB_SPD", { kind: "lighting", op: "speedDown" }],
  ["RGB_MODE_FORWARD", { kind: "lighting", op: "effectNext" }], ["RGB_MOD", { kind: "lighting", op: "effectNext" }],
  ["RGB_MODE_REVERSE", { kind: "lighting", op: "effectPrev" }], ["RGB_RMOD", { kind: "lighting", op: "effectPrev" }],
  ["OUT_USB", { kind: "output", to: "usb" }], ["OUT_BT", { kind: "output", to: "ble" }],
]);

// Shift, Ctrl, Alt and GUI names as ZMK's keys header spells them, short and long. A name not in here is not a modifier keyloom reads.
const ZMK_MODS = new Map<string, Mod>([
  ["LSHFT", "LSFT"], ["LSHIFT", "LSFT"], ["LEFT_SHIFT", "LSFT"], ["RSHFT", "RSFT"], ["RSHIFT", "RSFT"], ["RIGHT_SHIFT", "RSFT"],
  ["LCTRL", "LCTL"], ["LCTL", "LCTL"], ["RCTRL", "RCTL"], ["RCTL", "RCTL"],
  ["LALT", "LALT"], ["RALT", "RALT"], ["LGUI", "LGUI"], ["LCMD", "LGUI"], ["RGUI", "RGUI"], ["RCMD", "RGUI"],
]);

const BT_CLEAR = new Map<string, "clear" | "clearAll" | "next" | "previous">([["BT_CLR", "clear"], ["BT_CLR_ALL", "clearAll"], ["BT_NXT", "next"], ["BT_PRV", "previous"]]);

const ZMK_RGB = new Map<string, LightingOp>([
  ["RGB_TOG", "toggle"], ["RGB_HUI", "hueUp"], ["RGB_HUD", "hueDown"], ["RGB_SAI", "satUp"], ["RGB_SAD", "satDown"],
  ["RGB_BRI", "briUp"], ["RGB_BRD", "briDown"], ["RGB_SPI", "speedUp"], ["RGB_SPD", "speedDown"], ["RGB_EFF", "effectNext"], ["RGB_EFR", "effectPrev"],
]);

export function readNative(native: NativeSource, kept: KeptMap): Reading {
  if (native.firmware === "qmk") return readQmk(spaced(native.source, "qmk"));
  if (native.firmware === "zmk") return readZmk(native, kept);
  return { kind: "unknown" };
}

/**
 * The source with the spacing C and devicetree allow, in one shape: none around `(`, `)` and `|` (QMK), and one space between the
 * words of a ZMK call. Identifiers are not touched, so `Q K_BOOT` keeps its space and stays refused. Layer ref offsets stay in the
 * source as written, so they are read from the raw text (`paramSpan`).
 */
function spaced(source: string, firmware: "qmk" | "zmk"): string {
  const trimmed = source.trim();
  return firmware === "qmk" ? trimmed.replace(/\s*([()|])\s*/g, "$1").replace(/\s+/g, " ") : trimmed.replace(/\s+/g, " ");
}

function readQmk(source: string): Reading {
  const osm = QMK_OSM.exec(source);
  if (osm?.[1] !== undefined) return { kind: "steps", steps: [{ kind: "oneShot", mods: qmkOneShotMods(osm[1]) }] };
  const step = QMK_STEPS.get(source);
  return step === undefined ? { kind: "unknown" } : { kind: "steps", steps: [step] };
}

/**
 * QMK's one-shot holds five bits: the four modifiers and one right-hand flag, which makes every modifier in the set right-hand
 * (quantum/modifiers.h). So `OSM(MOD_LSFT|MOD_RSFT)` is right Shift alone, and `OSM(MOD_LCTL|MOD_RSFT)` is right Ctrl and right Shift.
 */
function qmkOneShotMods(names: string): Mod[] {
  const parts = names.split("|");
  const side = parts.some((p) => p.startsWith("MOD_R")) ? "R" : "L";
  const bases = new Set(parts.map((p) => p.slice(5)));
  return MOD_ORDER.filter((m) => m.startsWith(side) && bases.has(m.slice(1)));
}

function readZmk(native: NativeSource, kept: KeptMap): Reading {
  const source = spaced(native.source, "zmk");
  if (!ZMK_CALL.test(source)) return { kind: "unknown" };
  const calls = parseCalls(source);
  if (calls?.length !== 1 || calls[0] === undefined) return { kind: "unknown" };
  const call = calls[0];
  const def = kept.get(call.name);
  if (def === null) return { kind: "unknown" };
  if (def === undefined) {
    const steps = builtin(call.name, call.params);
    return steps === undefined ? { kind: "unknown" } : { kind: "steps", steps };
  }
  if (!takesArguments(call, def)) return { kind: "unknown" };
  if (def.compatible === HOLD_TAP) return holdLayer(native, call.params, def, kept);
  const steps = resolveKept(call, def, kept, 1);
  return steps === undefined ? { kind: "unknown" } : { kind: "steps", steps };
}

/** A call passes exactly the parameters its node declares with `#binding-cells`; a node that declares none reads no call. */
function takesArguments(call: KeptCall, def: KeptDefinition): boolean {
  return def.bindingCells !== undefined && call.params.length === def.bindingCells;
}

/**
 * `&magic 5 0` holds layer 5 and taps the macro. Only a hold on `&mo` is a momentary layer, and the layer is the one layerRefs names.
 * The tap's own steps come along, so a tap that does something risky (a bootloader) is named by the caller.
 */
function holdLayer(native: NativeSource, params: readonly string[], def: KeptDefinition, kept: KeptMap): Reading {
  const [hold, tap] = def.cells;
  if (def.cells.length !== 2 || hold?.length !== 1 || tap?.length !== 1 || hold[0]?.name !== "mo" || hold[0].params.length !== 0) return { kind: "unknown" };
  const tapCall = tap[0];
  const param = paramSpan(native.source, 0);
  if (tapCall === undefined || param === undefined) return { kind: "unknown" };
  const ref = (native.layerRefs ?? []).find((r) => r.start >= param.start && r.start < param.end);
  if (ref === undefined) return { kind: "unknown" };
  return { kind: "holdLayer", layerId: ref.layerId, tap: tapCall.name, tapSteps: tapSteps(tapCall, params[1], kept) };
}

/**
 * The tap's steps. The hold's second argument is forwarded to the tap as its parameter (`&magic 1 RGB_TOG` taps `&rgb_ug RGB_TOG`). A tap
 * that takes no parameter reads without it, since the template's `&magic MAGIC 0` passes a placeholder to a macro tap. ZMK ignores the
 * spare argument for a zero-argument behaviour; that is an assumption, not something read from the firmware here.
 */
function tapSteps(tapCall: KeptCall, forwarded: string | undefined, kept: KeptMap): readonly Step[] {
  const withArgument = forwarded === undefined ? undefined : resolveCall({ name: tapCall.name, params: [...tapCall.params, forwarded] }, kept, 1);
  return withArgument ?? resolveCall(tapCall, kept, 1) ?? [];
}

/**
 * Whether a new native's `layerRefs` are the ones its reading needs and nothing more. A layer hold's refs must each cover exactly its
 * layer parameter, and name its layer. Anything else that reads has no refs, so the generator never rewrites its source.
 */
export function admittedLayerRefs(native: NativeSource, kept: KeptMap): boolean {
  const refs = native.layerRefs ?? [];
  const reading = readNative(native, kept);
  if (reading.kind === "unknown") return false;
  if (reading.kind === "steps") return refs.length === 0;
  const param = paramSpan(native.source, 0);
  // Exactly one ref: two identical refs would make the generator write the layer number twice (`&magic 22 0`).
  const [only] = refs;
  return param !== undefined && refs.length === 1 && only !== undefined && only.start === param.start && only.end === param.end && only.layerId === reading.layerId;
}

/** A control that sets modes or timing and presses nothing, so the steps around it still read. */
function isMacroControl(call: KeptCall): boolean {
  if (MACRO_CONTROLS.has(call.name)) return call.params.length === 0;
  return MACRO_TIMING.has(call.name) && call.params.length === 1 && /^\d+$/.test(call.params[0] ?? "");
}

/** A kept behaviour's steps. A kept sticky key passes its parameter to `&sk`; a kept macro runs its calls in order. */
function resolveKept(call: KeptCall, def: KeptDefinition, kept: KeptMap, depth: number): Step[] | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (def.compatible === STICKY_KEY) {
    const only = def.cells.length === 1 && def.cells[0]?.length === 1 ? def.cells[0][0] : undefined;
    // ZMK's custom sticky key wraps `&kp` (or `&sk`) and passes its one parameter through, so both read as the one-shot of that modifier.
    if ((only?.name !== "sk" && only?.name !== "kp") || only.params.length !== 0 || call.params.length !== 1) return undefined;
    return builtin("sk", call.params);
  }
  if (def.compatible === MACRO) {
    if (call.params.length !== 0) return undefined;
    const steps: Step[] = [];
    for (const cell of def.cells) {
      for (const inner of cell) {
        if (!kept.has(inner.name) && isMacroControl(inner)) continue;
        const more = resolveCall(inner, kept, depth + 1);
        if (more === undefined) return undefined;
        steps.push(...more);
      }
    }
    return steps.length === 0 ? undefined : steps;
  }
  return undefined;
}

function resolveCall(call: KeptCall, kept: KeptMap, depth: number): Step[] | undefined {
  const def = kept.get(call.name);
  if (def === null) return undefined;
  if (def !== undefined) return takesArguments(call, def) ? resolveKept(call, def, kept, depth) : undefined;
  return builtin(call.name, call.params);
}

function builtin(name: string, params: readonly string[]): Step[] | undefined {
  switch (name) {
    case "sk": {
      const mod = params.length === 1 ? ZMK_MODS.get(params[0] ?? "") : undefined;
      return mod === undefined ? undefined : [{ kind: "oneShot", mods: [mod] }];
    }
    case "caps_word": return params.length === 0 ? [{ kind: "capsWord" }] : undefined;
    case "bootloader": return params.length === 0 ? [{ kind: "bootloader" }] : undefined;
    case "sys_reset": return params.length === 0 ? [{ kind: "reset" }] : undefined;
    case "rgb_ug": {
      const op = params.length === 1 ? ZMK_RGB.get(params[0] ?? "") : undefined;
      return op === undefined ? undefined : [{ kind: "lighting", op }];
    }
    case "bt": return bluetooth(params);
    case "out": {
      if (params.length !== 1) return undefined;
      if (params[0] === "OUT_USB") return [{ kind: "output", to: "usb" }];
      if (params[0] === "OUT_BLE") return [{ kind: "output", to: "ble" }];
      return undefined;
    }
    default: return undefined;
  }
}

function bluetooth(params: readonly string[]): Step[] | undefined {
  const [op, n] = params;
  if (params.length === 1) {
    const found = op === undefined ? undefined : BT_CLEAR.get(op);
    return found === undefined ? undefined : [{ kind: "bluetooth", op: found }];
  }
  if (params.length === 2 && op === "BT_SEL" && n !== undefined && /^\d+$/.test(n)) return [{ kind: "bluetoothSelect", profile: Number(n) }];
  return undefined;
}

/** Where the nth parameter of the source's one call sits in the text, for matching layerRefs. */
function paramSpan(source: string, n: number): { start: number; end: number } | undefined {
  const tokens = [...source.matchAll(/\S+/g)];
  const token = tokens[n + 1];
  if (token === undefined || token.index === undefined) return undefined;
  return { start: token.index, end: token.index + token[0].length };
}
