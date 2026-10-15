// Oryx writes macros as `SEND_STRING(SS_TAP(X_C) SS_DELAY(100) SS_LGUI(SS_TAP(X_V)))`. That
// argument is C string-literal pasting, not an expression, so tree-sitter can't parse it and this
// reads the text directly. Anything outside the generated pattern returns undefined and the
// caller keeps the key as `native` with the case in Passthrough (05).
import { fromQmk } from "../../layout/keycodes.ts";
import type { Macro, MacroStep, Mod } from "../../layout/schema.ts";

type Item = { name: string; arg: string; children: Item[] };

const WRAP_MODS = new Map<string, Mod>([
  ["SS_LCTL", "LCTL"], ["SS_LSFT", "LSFT"], ["SS_LALT", "LALT"], ["SS_LGUI", "LGUI"],
  ["SS_RCTL", "RCTL"], ["SS_RSFT", "RSFT"], ["SS_RALT", "RALT"], ["SS_RGUI", "RGUI"],
]);
const MOD_ORDER: Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];

/** `NAME(...)` items in sequence; undefined if the text is anything else (string literals, stray tokens). */
function parseItems(text: string): Item[] | undefined {
  const items: Item[] = [];
  let i = 0;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i] as string)) i++;
  };
  skipSpace();
  while (i < text.length) {
    if (text[i] === '"') {
      // A string literal is typed as written (macro text steps); only the escapes SEND_STRING needs are read.
      let literal = "";
      for (i++; ; i++) {
        const ch = text[i];
        if (ch === undefined) return undefined;
        if (ch === '"') break;
        if (ch === "\\") {
          const next = text[++i];
          const decoded = next === "n" ? "\n" : next === "t" ? "\t" : next === "\\" || next === '"' ? next : undefined;
          if (decoded === undefined) return undefined;
          literal += decoded;
        } else literal += ch;
      }
      i++;
      items.push({ name: "STRING", arg: literal, children: [] });
      skipSpace();
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (!m) return undefined;
    const name = m[0];
    i += name.length;
    if (text[i] !== "(") return undefined;
    const start = ++i;
    for (let depth = 1; depth > 0; i++) {
      const ch = text[i];
      if (ch === undefined) return undefined;
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === '"') return undefined;
    }
    const inner = text.slice(start, i - 1);
    const children = name === "SS_TAP" || name === "SS_DELAY" ? [] : parseItems(inner);
    if (!children) return undefined;
    items.push({ name, arg: inner.trim(), children });
    skipSpace();
  }
  return items;
}

function codeOf(arg: string): string | undefined {
  const m = /^X_([A-Z0-9_]+)$/.exec(arg);
  return m?.[1] ? fromQmk(`KC_${m[1]}`)?.name : undefined;
}

function emit(items: Item[], mods: Mod[]): MacroStep[] | undefined {
  const steps: MacroStep[] = [];
  for (const item of items) {
    const wrap = WRAP_MODS.get(item.name);
    if (item.name === "STRING") {
      if (mods.length > 0 || item.arg === "") return undefined;
      steps.push({ op: "text", text: item.arg });
    } else if (item.name === "SS_TAP") {
      const code = codeOf(item.arg);
      if (!code) return undefined;
      const sorted = MOD_ORDER.filter((m) => mods.includes(m));
      steps.push(sorted.length ? { op: "tap", code, mods: sorted } : { op: "tap", code });
    } else if (item.name === "SS_DELAY" && mods.length === 0) {
      const ms = Number(item.arg);
      if (!Number.isInteger(ms) || ms < 0) return undefined;
      steps.push({ op: "waitMs", ms });
    } else if (wrap) {
      const inner = emit(item.children, [...mods, wrap]);
      if (!inner) return undefined;
      steps.push(...inner);
    } else {
      return undefined; // SS_DOWN, SS_UP and anything else
    }
  }
  return steps;
}

/** The steps for a `case ST_MACRO_n:` body, or undefined when it isn't Oryx's pattern. */
export function parseMacroCase(caseText: string): { qmkName: string; steps: MacroStep[] } | undefined {
  const m = /^case\s+(ST_MACRO_\d+)\s*:\s*if\s*\(\s*record->event\.pressed\s*\)\s*\{\s*SEND_STRING\(([\s\S]*)\)\s*;\s*\}\s*break\s*;\s*$/.exec(
    caseText.trim(),
  );
  if (!m?.[1] || m[2] === undefined) return undefined;
  const items = parseItems(m[2]);
  const steps = items && items.length > 0 ? emit(items, []) : undefined;
  return steps && steps.length > 0 ? { qmkName: m[1], steps } : undefined;
}

export function macroFor(qmkName: string, steps: MacroStep[]): Macro {
  return { id: qmkName.toLowerCase().replaceAll("_", "-"), name: qmkName, steps };
}
