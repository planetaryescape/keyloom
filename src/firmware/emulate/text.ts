// The text a US-layout text field would show for a run of keyboard reports. It is for quick reading, not
// a model of an operating system: no key repeat, no compose keys, and a shortcut (Control, Alt or GUI held)
// types nothing.
import type { EmulatorReport } from "./types.ts";

const LOWER: Record<string, string> = {
  MINUS: "-", EQUAL: "=", LEFT_BRACKET: "[", RIGHT_BRACKET: "]", BACKSLASH: "\\", NONUS_HASH: "#", SEMICOLON: ";", QUOTE: "'", GRAVE: "`",
  COMMA: ",", DOT: ".", SLASH: "/", SPACE: " ", TAB: "\t", ENTER: "\n", NONUS_BACKSLASH: "\\",
  KP_SLASH: "/", KP_ASTERISK: "*", KP_MINUS: "-", KP_PLUS: "+", KP_ENTER: "\n", KP_DOT: ".", KP_EQUAL: "=", KP_COMMA: ",",
};
const SHIFTED: Record<string, string> = {
  N1: "!", N2: "@", N3: "#", N4: "$", N5: "%", N6: "^", N7: "&", N8: "*", N9: "(", N0: ")", MINUS: "_", EQUAL: "+", LEFT_BRACKET: "{",
  RIGHT_BRACKET: "}", BACKSLASH: "|", NONUS_HASH: "~", SEMICOLON: ":", QUOTE: '"', GRAVE: "~", COMMA: "<", DOT: ">", SLASH: "?", NONUS_BACKSLASH: "|",
};

function character(key: string, shift: boolean, capsLock: boolean): string | undefined {
  if (/^[A-Z]$/.test(key)) return shift !== capsLock ? key : key.toLowerCase();
  const digit = /^N(\d)$/.exec(key) ?? /^KP_(\d)$/.exec(key);
  if (digit) return key.startsWith("KP_") || !shift ? (digit[1] as string) : SHIFTED[key];
  return shift ? (SHIFTED[key] ?? LOWER[key]) : LOWER[key];
}

export function typedText(reports: readonly EmulatorReport[]): string {
  let text = "";
  let capsLock = false;
  let down = new Set<string>();
  for (const r of reports) {
    if (r.kind !== "keyboard") continue;
    const shortcut = r.mods.some((m) => m !== "LSFT" && m !== "RSFT");
    const shift = r.mods.includes("LSFT") || r.mods.includes("RSFT");
    // A key typed is a key that wasn't in the report before.
    for (const key of r.keys.filter((k) => !down.has(k))) {
      if (key === "CAPS_LOCK") capsLock = !capsLock;
      else if (shortcut) continue;
      else if (key === "BACKSPACE") text = Array.from(text).slice(0, -1).join("");
      else text += character(key, shift, capsLock) ?? "";
    }
    down = new Set(r.keys);
  }
  return text;
}
