// What a cap prints for a binding keyloom keeps as firmware source (`native`): words a person reads, never the firmware's own spelling
// (D-270). Each kind of kept binding in BK's layouts has a legend here; anything else falls back to its importer's label when that is
// already a short word, and to "Custom" otherwise. Advanced view still shows the source. Pure.
import { fromQmk, fromZmk } from "./keycodes.ts";
import type { GridContext } from "./render-grid.ts";
import type { Binding, Mod } from "./schema.ts";
import { capMods, layerLegend } from "./cap-words.ts";
import { renumber } from "./layer-refs.ts";

type Native = Extract<Binding, { kind: "native" }>;
export type NativePrint = { tap: string; hold?: string; layerId?: string };

const MOD_OF: Readonly<Record<string, Mod>> = {
  MOD_LSFT: "LSFT", MOD_RSFT: "RSFT", MOD_LCTL: "LCTL", MOD_RCTL: "RCTL", MOD_LALT: "LALT", MOD_RALT: "RALT", MOD_LGUI: "LGUI", MOD_RGUI: "RGUI",
  LEFT_SHIFT: "LSFT", RIGHT_SHIFT: "RSFT", LSHIFT: "LSFT", RSHIFT: "RSFT", LEFT_CONTROL: "LCTL", RIGHT_CONTROL: "RCTL", LCTRL: "LCTL", RCTRL: "RCTL",
  LEFT_ALT: "LALT", RIGHT_ALT: "RALT", LALT: "LALT", RALT: "RALT", LEFT_GUI: "LGUI", RIGHT_GUI: "RGUI", LGUI: "LGUI", RGUI: "RGUI",
};

// Lighting keys, QMK's and ZMK's names alike: what they change, with "lights" on the front.
const LIGHT: Readonly<Record<string, string>> = {
  RGB_TOG: "On/off", RGB_MODE_FORWARD: "Effect", RGB_MOD: "Effect", RGB_EFF: "Effect", RGB_MODE_REVERSE: "Effect", RGB_RMOD: "Effect", RGB_EFR: "Effect",
  RGB_HUI: "Hue+", RGB_HUD: "Hue−", RGB_SAI: "Sat+", RGB_SAD: "Sat−", RGB_VAI: "Bri+", RGB_VAD: "Bri−", RGB_BRI: "Bri+", RGB_BRD: "Bri−",
  RGB_SPI: "Speed+", RGB_SPD: "Speed−", RGB_SLD: "Static", TOGGLE_LAYER_COLOR: "Layer", RGB_M_P: "Static",
};

const MOUSE: Readonly<Record<string, string>> = {
  KC_MS_BTN1: "Click", KC_BTN1: "Click", KC_MS_BTN2: "Right", KC_BTN2: "Right", KC_MS_BTN3: "Middle", KC_BTN3: "Middle",
  KC_MS_LEFT: "←", KC_MS_L: "←", KC_MS_RIGHT: "→", KC_MS_R: "→", KC_MS_UP: "↑", KC_MS_U: "↑", KC_MS_DOWN: "↓", KC_MS_D: "↓",
  KC_MS_WH_UP: "Scroll↑", KC_WH_U: "Scroll↑", KC_MS_WH_DOWN: "Scroll↓", KC_WH_D: "Scroll↓",
};

const keyWord = (qmkOrZmk: string): string | null => {
  const info = fromQmk(qmkOrZmk) ?? fromZmk(qmkOrZmk);
  if (info === undefined) return null;
  return { ENTER: "⏎", SPACE: "Space", TAB: "⇥", BACKSPACE: "⌫", ESCAPE: "Esc" }[info.name as string] ?? info.label;
};

// "LA(SPACE)": ZMK's modifier wrappers around a key.
const ZMK_WRAP: Readonly<Record<string, Mod>> = { LA: "LALT", RA: "RALT", LC: "LCTL", RC: "RCTL", LS: "LSFT", RS: "RSFT", LG: "LGUI", RG: "RGUI" };
function zmkKey(expression: string): string | null {
  const wrap = /^([LR][ACSG])\((.+)\)$/.exec(expression);
  if (wrap !== null) {
    const inner = zmkKey(wrap[2] as string);
    const mod = ZMK_WRAP[wrap[1] as string];
    return inner === null || mod === undefined ? null : `${capMods([mod])}${inner === "Space" ? "␣" : inner}`;
  }
  return keyWord(expression);
}

const layerAt = (ctx: GridContext, index: number): string | undefined => ctx.layers[index]?.id;

// An Oryx "dual function" key is a placeholder (LT(n, KC_x)) whose real tap and hold are in process_record_user (S16).
function dualFunction(name: string, ctx: GridContext): NativePrint | null {
  const kept = (anchor: string): string => {
    const p = ctx.passthrough?.find((q) => q.anchor === anchor);
    return p === undefined ? "" : renumber(p.source, p.layerRefs, ctx.layers.map((l) => l.id));
  };
  const define = kept(`define:${name}`);
  const handler = kept(`process_record_user:${name}`);
  const lt = /LT\(\s*(\d+)\s*,\s*(KC_\w+)\s*\)/.exec(define);
  const tapCode = /register_code16\(\s*(KC_\w+)\s*\)/.exec(handler)?.[1] ?? lt?.[2];
  const layerIndex = Number(/layer_move\(\s*(\d+)\s*\)/.exec(handler)?.[1] ?? lt?.[1] ?? Number.NaN);
  const tap = tapCode === undefined ? null : keyWord(tapCode);
  const layerId = Number.isNaN(layerIndex) ? undefined : layerAt(ctx, layerIndex);
  if (tap === null) return null;
  return layerId === undefined ? { tap } : { tap, hold: layerLegend(layerId, ctx), layerId };
}

export function nativeLegend(binding: Native, ctx: GridContext): NativePrint {
  // The numbers in the source are the ones the layers had when it was imported; the cap reads them as the layers are now.
  const source = renumber(binding.source, binding.layerRefs, ctx.layers.map((l) => l.id)).trim();
  // QMK
  const osm = /^OSM\(\s*([A-Z_|\s]+)\)$/.exec(source);
  if (osm !== null) {
    const mods = (osm[1] as string).split("|").flatMap((part) => (MOD_OF[part.trim()] === undefined ? [] : [MOD_OF[part.trim()] as Mod]));
    if (mods.length > 0) return { tap: capMods(mods), hold: "once" };
  }
  if (/^DUAL_FUNC_\d+$/.test(source)) {
    const dual = dualFunction(source, ctx);
    if (dual !== null) return dual;
  }
  if (LIGHT[source] !== undefined) return { tap: LIGHT[source] as string, hold: "lights" };
  if (MOUSE[source] !== undefined) return { tap: MOUSE[source] as string, hold: "mouse" };
  if (source === "QK_BOOT" || source === "RESET" || source === "&bootloader") return { tap: "Boot", hold: "flash" };
  // ZMK
  const sticky = /^&(?:sticky_key_quick_release|sk)\s+(\w+)$/.exec(source);
  if (sticky !== null && MOD_OF[sticky[1] as string] !== undefined) return { tap: capMods([MOD_OF[sticky[1] as string] as Mod]), hold: "once" };
  const onHold = /^&layer_on_hold\s+(\d+)\s+(.+)$/.exec(source);
  if (onHold !== null) {
    const layerId = layerAt(ctx, Number(onHold[1]));
    const tap = zmkKey((onHold[2] as string).trim()) ?? "Tap";
    return layerId === undefined ? { tap } : { tap, hold: layerLegend(layerId, ctx), layerId };
  }
  const magic = /^&magic\s+(\d+)/.exec(source);
  if (magic !== null) {
    const layerId = layerAt(ctx, Number(magic[1]));
    return layerId === undefined ? { tap: "Magic" } : { tap: "Magic", hold: layerLegend(layerId, ctx), layerId };
  }
  const rgb = /^&rgb_ug\s+(\w+)$/.exec(source);
  if (rgb !== null && LIGHT[rgb[1] as string] !== undefined) return { tap: LIGHT[rgb[1] as string] as string, hold: "lights" };
  if (source === "&sys_reset") return { tap: "Restart" };
  const bt = /^&bt(?:_|\s+BT_SEL\s+)(\d)$/.exec(source);
  // "bluetooth" is too long for a 1u front at the legend floor, and "BT" already says it.
  if (bt !== null) return { tap: `BT ${Number(bt[1]) + 1}` };
  if (source === "&bt BT_CLR") return { tap: "Unpair" };
  if (source === "&bt BT_CLR_ALL") return { tap: "Unpair", hold: "all" };
  const out = /^&out\s+OUT_(USB|BLE|TOG)$/.exec(source);
  if (out !== null) return { tap: { USB: "USB", BLE: "Wireless", TOG: "USB/BT" }[out[1] as "USB" | "BLE" | "TOG"], hold: "output" };
  // Anything else: the importer's label when it already reads as a word, else "Custom". The source is in Advanced view and the panel.
  const label = binding.label.trim();
  return /^[A-Za-z][a-z]{1,7}$|^fn$/.test(label) ? { tap: label } : { tap: "Custom" };
}
