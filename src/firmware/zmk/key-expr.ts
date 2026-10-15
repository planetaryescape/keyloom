// ZMK key expressions both ways: `LC(LS(A))`, `LSHFT`, `EXCL` <-> a key and its modifiers.
import { type KeyCode, type KeyCodeInfo, fromZmk, fromZmkShifted, isKeyCode, keyCodeInfo } from "../../layout/keycodes.ts";
import type { Mod } from "../../layout/schema.ts";
import { type Defines, expand } from "./defines.ts";

export const MOD_ORDER: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];
export const sortMods = (mods: Iterable<Mod>): Mod[] => {
  const set = new Set(mods);
  return MOD_ORDER.filter((m) => set.has(m));
};

const WRAPPERS = new Map<string, Mod>([
  ["LC", "LCTL"], ["LS", "LSFT"], ["LA", "LALT"], ["LG", "LGUI"], ["RC", "RCTL"], ["RS", "RSFT"], ["RA", "RALT"], ["RG", "RGUI"],
]);
const WRAPPER_OF = new Map([...WRAPPERS].map(([w, m]) => [m, w] as const));

// KeyCodes that are modifier keys (`&kp LSHFT`) are `modifier` bindings, not `key` ones.
const MODIFIER_KEYS = new Map<string, Mod>([
  ["LEFT_CTRL", "LCTL"], ["LEFT_SHIFT", "LSFT"], ["LEFT_ALT", "LALT"], ["LEFT_GUI", "LGUI"],
  ["RIGHT_CTRL", "RCTL"], ["RIGHT_SHIFT", "RSFT"], ["RIGHT_ALT", "RALT"], ["RIGHT_GUI", "RGUI"],
]);
export const MODIFIER_CODES = new Map<Mod, string>([...MODIFIER_KEYS].map(([code, mod]) => [mod, code] as const));
const KEY_OF = new Map<Mod, string>([
  ["LCTL", "LCTRL"], ["LSFT", "LSHFT"], ["LALT", "LALT"], ["LGUI", "LGUI"], ["RCTL", "RCTRL"], ["RSFT", "RSHFT"], ["RALT", "RALT"], ["RGUI", "RGUI"],
]);

/** The shortest ZMK name for a key (`N1`, `LEFT`, `BSPC`), so the keymap stays readable; every alias means the same key. */
const shortestName = (code: KeyCode): string => keyCodeInfo(code).zmk.reduce((best, n) => (n.length < best.length ? n : best));

export type KeyExpr = { key?: KeyCodeInfo; mods: Mod[] };

function parse(text: string): KeyExpr | undefined {
  const t = text.trim();
  if (/^\(.*\)$/s.test(t)) return parse(t.slice(1, -1));
  const call = /^([A-Z]{2})\((.*)\)$/s.exec(t);
  if (call) {
    const mod = WRAPPERS.get(call[1] as string);
    const inner = mod ? parse(call[2] as string) : undefined;
    return mod && inner ? { ...(inner.key ? { key: inner.key } : {}), mods: [...inner.mods, mod] } : undefined;
  }
  if (!/^[A-Za-z_]\w*$/.test(t)) return undefined;
  const info = fromZmk(t);
  if (info) {
    const mod = MODIFIER_KEYS.get(info.name);
    return mod ? { mods: [mod] } : { key: info, mods: [] };
  }
  const shifted = fromZmkShifted(t);
  return shifted ? { key: keyCodeInfo(shifted.code), mods: ["LSFT"] } : undefined;
}

/** Undefined when the text is not a key keyloom models (an unknown name, a function-like define, two keys). */
export function parseKeyExpr(text: string, defines: Defines): KeyExpr | undefined {
  const r = parse(expand(text, defines));
  return r ? { ...(r.key ? { key: r.key } : {}), mods: sortMods(r.mods) } : undefined;
}

/** `LC(LS(A))` for A with Control and Shift; for modifiers alone the last one is the key, `LC(LSHFT)`. */
export function keyExprText(e: { code?: string; mods?: readonly Mod[] }): string {
  const mods = sortMods(e.mods ?? []);
  let inner: string;
  let wrap = mods;
  if (e.code !== undefined) {
    if (!isKeyCode(e.code)) throw new Error(`${e.code} is not a key keyloom knows`);
    inner = shortestName(e.code);
  }
  else {
    const last = mods.at(-1);
    if (last === undefined) throw new Error("a key expression needs a key or a modifier");
    inner = KEY_OF.get(last) as string;
    wrap = mods.slice(0, -1);
  }
  return [...wrap].reverse().reduce((acc, m) => `${WRAPPER_OF.get(m)}(${acc})`, inner);
}
