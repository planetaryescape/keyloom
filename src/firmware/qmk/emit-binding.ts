// A keyloom Binding to the QMK keycode expression that goes in LAYOUT(...). The inverse of
// bindings.ts; the round-trip test is what keeps the two honest.
import { type KeyCode, type KeyCodeInfo, isKeyCode, keyCodeInfo, qmkName } from "../../layout/keycodes.ts";
import type { Binding, Mod } from "../../layout/schema.ts";
import { GenerateError } from "./generate-error.ts";

export type EmitContext = {
  /** Layer ID to its index in keymaps[]. */
  layerIndex: ReadonlyMap<string, number>;
  /** Macro ID to the `ST_MACRO_n` name its case in process_record_user uses. */
  macroNames: ReadonlyMap<string, string>;
  /** Tap dance ID to the `DANCE_n` name its entry in tap_dance_actions[] has. */
  tapDanceNames: ReadonlyMap<string, string>;
};

export const MOD_ORDER: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];
const sortMods = (mods: readonly Mod[]): Mod[] => MOD_ORDER.filter((m) => mods.includes(m));

const MOD_KEY: Record<Mod, KeyCode> = {
  LCTL: "LEFT_CTRL", LSFT: "LEFT_SHIFT", LALT: "LEFT_ALT", LGUI: "LEFT_GUI",
  RCTL: "RIGHT_CTRL", RSFT: "RIGHT_SHIFT", RALT: "RIGHT_ALT", RGUI: "RIGHT_GUI",
};

const sameSet = (a: readonly Mod[], b: readonly Mod[]): boolean => a.length === b.length && b.every((m) => a.includes(m));
const HYPER: Mod[] = ["LCTL", "LSFT", "LALT", "LGUI"];
const MEH: Mod[] = ["LCTL", "LSFT", "LALT"];

/** QMK stores one hand bit for a whole modifier set, so a set can't mix left and right. */
function assertOneHand(mods: readonly Mod[]): void {
  if (mods.some((m) => m.startsWith("L")) && mods.some((m) => m.startsWith("R"))) {
    throw new GenerateError(`${mods.join("+")} mixes left and right modifiers, which QMK can't send together from one key`);
  }
}

function known(code: string): KeyCodeInfo {
  if (!isKeyCode(code)) throw new GenerateError(`"${code}" is not a key code keyloom knows`);
  return keyCodeInfo(code);
}

/** `LCTL(LSFT(KC_A))`: the wrapper functions are named like the mods. */
function wrap(mods: readonly Mod[], inner: string): string {
  return sortMods(mods).reduceRight((acc, m) => `${m}(${acc})`, inner);
}

/** The tap side of a hold-tap: MT() and LT() store it in 8 bits, with no modifiers. */
function tapKey(tap: { code: string; mods?: readonly Mod[] | undefined }): string {
  const info = known(tap.code);
  if (tap.mods?.length) throw new GenerateError(`a hold-tap's tap side can't carry modifiers (${tap.mods.join("+")}+${tap.code}); QMK's MT() and LT() take a plain key`);
  if (!info.qmkBasic) throw new GenerateError(`${tap.code} can't be the tap side of a hold-tap; QMK's MT() and LT() take a basic 8-bit key`);
  return qmkName(info.name);
}

export function bindingToC(b: Binding, ctx: EmitContext): string {
  switch (b.kind) {
    case "transparent":
      return "KC_TRANSPARENT";
    case "none":
      return "KC_NO";
    case "key": {
      const info = known(b.code);
      if (!b.mods?.length) return qmkName(info.name);
      assertOneHand(b.mods);
      if (!info.qmkBasic) throw new GenerateError(`${b.code} can't carry modifiers; QMK wraps only basic 8-bit keys`);
      return wrap(b.mods, qmkName(info.name));
    }
    case "modifier": {
      const mods = sortMods(b.mods);
      assertOneHand(mods);
      if (mods.length === 1) return qmkName(MOD_KEY[mods[0] as Mod]);
      if (sameSet(mods, HYPER)) return "KC_HYPR";
      if (sameSet(mods, MEH)) return "KC_MEH";
      // No single keycode sends this set: wrap all but one modifier around the last one's key.
      return wrap(mods.slice(0, -1), qmkName(MOD_KEY[mods[mods.length - 1] as Mod]));
    }
    case "holdTap": {
      const tap = tapKey(b.tap);
      if ("layerId" in b.hold) {
        const layer = layerOf(b.hold.layerId, ctx);
        if (layer > 15) throw new GenerateError(`LT() holds layers 0-15 only, and ${b.hold.layerId} is layer ${layer}`);
        return `LT(${layer}, ${tap})`;
      }
      const mods = sortMods(b.hold.mods);
      assertOneHand(mods);
      if (sameSet(mods, HYPER)) return `ALL_T(${tap})`;
      return `MT(${mods.map((m) => `MOD_${m}`).join(" | ")}, ${tap})`;
    }
    case "layer": {
      const fn = { momentary: "MO", toggle: "TG", to: "TO", oneShot: "OSL" }[b.action];
      return `${fn}(${layerOf(b.layerId, ctx)})`;
    }
    case "macro": {
      const name = ctx.macroNames.get(b.macroId);
      if (!name) throw new GenerateError(`macro "${b.macroId}" doesn't exist`);
      return name;
    }
    case "tapDance": {
      const name = ctx.tapDanceNames.get(b.tapDanceId);
      if (!name) throw new GenerateError(`tap dance "${b.tapDanceId}" doesn't exist`);
      return `TD(${name})`;
    }
    case "native":
      if (b.firmware !== "qmk") throw new GenerateError(`a ${b.firmware} native binding (${b.source}) can't go in QMK source`);
      return b.source;
  }
}

function layerOf(layerId: string, ctx: EmitContext): number {
  const index = ctx.layerIndex.get(layerId);
  if (index === undefined) throw new GenerateError(`layer "${layerId}" doesn't exist`);
  return index;
}
