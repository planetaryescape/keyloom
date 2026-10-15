// A keyloom Macro to the Oryx-style `case ST_MACRO_n:` block in process_record_user, and the
// ST_MACRO_n names. The shape matches what send-string.ts reads back, so a generated macro
// round-trips; steps it can't read (press/release) are still valid C and import as native.
import { type KeyCode, isKeyCode, qmkName } from "../../layout/keycodes.ts";
import type { Macro, MacroStep, Mod } from "../../layout/schema.ts";
import { textKeys } from "../../layout/text-keys.ts";
import { GenerateError } from "./generate-error.ts";

const MOD_ORDER: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];
const MOD_KEY: Record<Mod, KeyCode> = {
  LCTL: "LEFT_CTRL", LSFT: "LEFT_SHIFT", LALT: "LEFT_ALT", LGUI: "LEFT_GUI",
  RCTL: "RIGHT_CTRL", RSFT: "RIGHT_SHIFT", RALT: "RIGHT_ALT", RGUI: "RIGHT_GUI",
};

// QMK's send_string_keycodes.h has an X_ name for every key keyloom knows except this one
// (checked against the pinned firmware25 tree).
const NO_SEND_STRING_NAME = new Set<KeyCode>(["MISSION_CONTROL"]);

function xName(code: string): string {
  if (!isKeyCode(code)) throw new GenerateError(`"${code}" is not a key code keyloom knows`);
  if (NO_SEND_STRING_NAME.has(code)) throw new GenerateError(`${code} can't be typed from a macro; QMK's SEND_STRING has no name for it`);
  return `X_${qmkName(code).slice("KC_".length)}`;
}

const xMod = (m: Mod): string => xName(MOD_KEY[m]);
const sorted = (mods: readonly Mod[] | undefined): Mod[] => MOD_ORDER.filter((m) => mods?.includes(m));

/** A C string literal for text SEND_STRING types. It escapes only what a literal needs; the shifts are SEND_STRING's own. */
export function textLiteral(text: string): string {
  const typed = textKeys(text);
  if (!typed.ok) throw new GenerateError(`"${typed.char}" can't be typed by a text step; keyloom types US-layout letters, digits and punctuation`);
  const escaped = [...text].map((ch) => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\t": "\\t" })[ch] ?? ch).join("");
  return `"${escaped}"`;
}

function stepToC(step: MacroStep): string {
  if (step.op === "waitMs") return `SS_DELAY(${step.ms})`;
  if (step.op === "text") return textLiteral(step.text);
  const mods = sorted(step.mods);
  if (!step.code && mods.length === 0) throw new GenerateError(`a ${step.op} step needs a key or modifiers`);
  if (step.op === "tap") {
    // The last modifier (GUI) ends up outermost, which is how Oryx nests Cmd+Shift+4, so a macro compiles to the same bytes.
    if (step.code) return mods.reduce((inner, m) => `SS_${m}(${inner})`, `SS_TAP(${xName(step.code)})`);
    return mods.length === 1 ? `SS_TAP(${xMod(mods[0] as Mod)})` : `${mods.map((m) => `SS_DOWN(${xMod(m)})`).join(" ")} ${[...mods].reverse().map((m) => `SS_UP(${xMod(m)})`).join(" ")}`;
  }
  // press: modifiers first, then the key. release: the key first, then the modifiers, in reverse.
  const dir = step.op === "press" ? "SS_DOWN" : "SS_UP";
  const parts = mods.map((m) => `${dir}(${xMod(m)})`);
  if (step.code) parts.push(`${dir}(${xName(step.code)})`);
  return (step.op === "press" ? parts : parts.reverse()).join(" ");
}

/** The argument of SEND_STRING that types the macro. */
export function macroBody(macro: Macro): string {
  try {
    return macro.steps.map(stepToC).join(" ");
  } catch (err) {
    if (err instanceof GenerateError) throw new GenerateError(`macro "${macro.name}": ${err.message}`);
    throw err;
  }
}

/** The `case` block for one macro, written the way Oryx writes it. */
export function macroCase(cName: string, macro: Macro): string {
  const body = macroBody(macro);
  return `    case ${cName}:\n    if (record->event.pressed) {\n      SEND_STRING(${body});\n    }\n    break;`;
}

const ORYX_NAME = /^ST_MACRO_\d+$/;

/**
 * Macro ID to C name. A macro already called ST_MACRO_n keeps that name, because passthrough code
 * may mention it; the rest take the lowest free numbers, in layout order, so output is deterministic.
 */
export function macroNames(macros: readonly Macro[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const m of macros) {
    if (ORYX_NAME.test(m.name) && !used.has(m.name)) {
      names.set(m.id, m.name);
      used.add(m.name);
    }
  }
  let next = 0;
  for (const m of macros) {
    if (names.has(m.id)) continue;
    while (used.has(`ST_MACRO_${next}`)) next++;
    names.set(m.id, `ST_MACRO_${next}`);
    used.add(`ST_MACRO_${next}`);
  }
  return names;
}

