// How keyloom keys, modifiers and characters are written in a kanata config (21). Names come from the generated
// key table, whose kanata column is read from kanata's own source at a pinned SHA (scripts/gen-keycodes.ts).
import { type KeyCode, isKeyCode, kanataName, keyCodeInfo } from "../keycodes.ts";
import type { Mod } from "../schema.ts";
import { textKeys } from "../text-keys.ts";
import { GenerateError } from "./generate-error.ts";

/** Throws GenerateError for a key kanata can't send on macOS, so every writer refuses it the same way (kanata-rules.ts, transfer.ts). */
export function keyName(code: string): string {
  const name = isKeyCode(code) ? kanataName(code) : undefined;
  if (name === undefined) throw new GenerateError(`${isKeyCode(code) ? keyCodeInfo(code).label : code} has no kanata key name on macOS, so kanata can't send it`);
  return name;
}

/** Inside `macro`, a bare number is a delay, so the number-row keys are written by their long names. */
export const inMacro = (name: string): string => (/^\d$/.test(name) ? `Digit${name}` : name);

/** kanata's output-chord prefixes (config.adoc "Output chords/combos"). `M-` is Left Meta, which is Command on a Mac. */
const PREFIX: Record<Mod, string> = { LCTL: "C-", LSFT: "S-", LALT: "A-", LGUI: "M-", RCTL: "RC-", RSFT: "RS-", RALT: "RA-", RGUI: "RM-" };
const ORDER: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];

const MOD_KEY: Record<Mod, KeyCode> = {
  LCTL: "LEFT_CTRL", LSFT: "LEFT_SHIFT", LALT: "LEFT_ALT", LGUI: "LEFT_GUI", RCTL: "RIGHT_CTRL", RSFT: "RIGHT_SHIFT", RALT: "RIGHT_ALT", RGUI: "RIGHT_GUI",
};

/** A key with modifiers held around it: `S-a`, `C-S-c`. */
export function chord(code: string, mods: readonly Mod[] | undefined, inMacroContext = false): string {
  const base = inMacroContext ? inMacro(keyName(code)) : keyName(code);
  return `${ORDER.filter((m) => mods?.includes(m)).map((m) => PREFIX[m]).join("")}${base}`;
}

/** Modifiers held as a key press: one name, or a `multi` of several. */
export function modAction(mods: readonly Mod[]): string {
  const names = ORDER.filter((m) => mods.includes(m)).map((m) => keyName(MOD_KEY[m]));
  return names.length === 1 ? (names[0] as string) : `(multi ${names.join(" ")})`;
}

/** The macro items that type `text` on a US layout. */
export function textMacroItems(text: string): string[] {
  const keys = textKeys(text);
  if (!keys.ok) throw new GenerateError(`the text step contains ${JSON.stringify(keys.char)}, which a US layout can't type`);
  return keys.keys.map((k) => (k.shift ? `S-${inMacro(keyName(k.code))}` : inMacro(keyName(k.code))));
}

/** kanata atoms that are safe as an alias or layer name. */
export const safeName = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "-");
