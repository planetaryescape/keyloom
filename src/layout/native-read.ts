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
  if (native.firmware === "qmk") return readQmk(native.source);
  if (native.firmware === "zmk") return readZmk(native, kept);
  return { kind: "unknown" };
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
  if (!ZMK_CALL.test(native.source)) return { kind: "unknown" };
  const calls = parseCalls(native.source);
  if (calls?.length !== 1 || calls[0] === undefined) return { kind: "unknown" };
  const call = calls[0];
  const def = kept.get(call.name);
  if (def === null) return { kind: "unknown" };
  if (def === undefined) {
    const steps = builtin(call.name, call.params);
    return steps === undefined ? { kind: "unknown" } : { kind: "steps", steps };
  }
  if (def.compatible === HOLD_TAP) return holdLayer(native, call, def);
  const steps = resolveKept(call, def, kept, 1);
  return steps === undefined ? { kind: "unknown" } : { kind: "steps", steps };
}

/** `&magic 5 0` holds layer 5 and taps the macro. Only a hold on `&mo` is a momentary layer, and the layer is the one layerRefs names. */
function holdLayer(native: NativeSource, call: KeptCall, def: KeptDefinition): Reading {
  const [hold, tap] = def.cells;
  if (def.cells.length !== 2 || hold?.length !== 1 || tap?.length !== 1 || hold[0]?.name !== "mo" || hold[0].params.length !== 0) return { kind: "unknown" };
  const tapName = tap[0]?.name;
  const param = paramSpan(native.source, 0);
  if (tapName === undefined || param === undefined) return { kind: "unknown" };
  const ref = (native.layerRefs ?? []).find((r) => r.start >= param.start && r.start < param.end);
  return ref === undefined ? { kind: "unknown" } : { kind: "holdLayer", layerId: ref.layerId, tap: tapName };
}

/** A kept behaviour's steps. A kept sticky key passes its parameter to `&sk`; a kept macro runs its calls in order. */
function resolveKept(call: KeptCall, def: KeptDefinition, kept: KeptMap, depth: number): Step[] | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (def.compatible === STICKY_KEY) {
    const only = def.cells.length === 1 && def.cells[0]?.length === 1 ? def.cells[0][0] : undefined;
    if (only?.name !== "sk" || only.params.length !== 0 || call.params.length !== 1) return undefined;
    return builtin("sk", call.params);
  }
  if (def.compatible === MACRO) {
    if (call.params.length !== 0) return undefined;
    const steps: Step[] = [];
    for (const cell of def.cells) {
      for (const inner of cell) {
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
  if (def !== undefined) return resolveKept(call, def, kept, depth);
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
