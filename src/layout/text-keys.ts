// The US-layout key presses that type a piece of text (a macro's text step). ZMK has no "send this
// string", so its generator needs the keys; QMK's SEND_STRING does this itself, and uses the same
// check so that a text step either types on both firmwares or is refused on both.
import { type KeyCode, KEYCODES } from "./keycodes.ts";

export type TextKey = { code: KeyCode; shift: boolean };

const UNSHIFTED: ReadonlyArray<[string, KeyCode]> = [
  [" ", "SPACE"], ["\n", "ENTER"], ["\t", "TAB"], ["-", "MINUS"], ["=", "EQUAL"], ["[", "LEFT_BRACKET"], ["]", "RIGHT_BRACKET"],
  ["\\", "BACKSLASH"], [";", "SEMICOLON"], ["'", "QUOTE"], ["`", "GRAVE"], [",", "COMMA"], [".", "DOT"], ["/", "SLASH"],
];

// Shifted symbols come from the key table (its shifted rows are labelled with the character they type).
const SHIFTED_SYMBOLS: ReadonlyArray<[string, KeyCode]> = [
  ["~", "GRAVE"], ["!", "N1"], ["@", "N2"], ["#", "N3"], ["$", "N4"], ["%", "N5"], ["^", "N6"], ["&", "N7"], ["*", "N8"], ["(", "N9"],
  [")", "N0"], ["_", "MINUS"], ["+", "EQUAL"], ["{", "LEFT_BRACKET"], ["}", "RIGHT_BRACKET"], ["|", "BACKSLASH"], [":", "SEMICOLON"],
  ['"', "QUOTE"], ["<", "COMMA"], [">", "DOT"], ["?", "SLASH"],
];

const BY_CHAR = new Map<string, TextKey>();
for (const [ch, code] of UNSHIFTED) BY_CHAR.set(ch, { code, shift: false });
for (const [ch, code] of SHIFTED_SYMBOLS) BY_CHAR.set(ch, { code, shift: true });
for (const k of KEYCODES) {
  if (k.category === "letter" && /^[A-Z]$/.test(k.name)) {
    BY_CHAR.set(k.name.toLowerCase(), { code: k.name, shift: false });
    BY_CHAR.set(k.name, { code: k.name, shift: true });
  }
}
for (let d = 0; d <= 9; d++) BY_CHAR.set(String(d), { code: `N${d}` as KeyCode, shift: false });

/** The key presses that type `text`, or the first character that can't be typed from a US layout. */
export function textKeys(text: string): { ok: true; keys: TextKey[] } | { ok: false; char: string } {
  const keys: TextKey[] = [];
  for (const ch of text) {
    const key = BY_CHAR.get(ch);
    if (!key) return { ok: false, char: ch };
    keys.push(key);
  }
  return { ok: true, keys };
}
