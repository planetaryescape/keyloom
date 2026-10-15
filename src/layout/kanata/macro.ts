// A macro as kanata's `(macro ...)` (21).
import type { Macro, Mod } from "../schema.ts";
import { GenerateError } from "./generate-error.ts";
import { chord, textMacroItems } from "./names.ts";

/** A macro as kanata's `(macro ...)`: keys tap in order, `press`/`release` of modifiers wrap what is tapped between them. */
export function macroAction(m: Macro): string {
  const held = new Set<Mod>();
  const items: string[] = [];
  const mods = () => [...held];
  for (const step of m.steps) {
    if (step.op === "waitMs") {
      if (step.ms > 0) items.push(String(step.ms));
    } else if (step.op === "text") {
      if (held.size > 0) throw new GenerateError(`macro "${m.name}": a text step can't run while a modifier is held`);
      items.push(...textMacroItems(step.text));
    } else if (step.op === "tap") {
      if (step.code === undefined) throw new GenerateError(`macro "${m.name}": a tap step needs a key`);
      const all = new Set([...mods(), ...(step.mods ?? [])]);
      items.push(chord(step.code, [...all], true));
    } else {
      // press / release: only a modifier can be held across other steps in a kanata macro.
      const mod = step.code === undefined ? undefined : MOD_OF_KEY[step.code];
      if (mod === undefined) throw new GenerateError(`macro "${m.name}": ${step.op} of ${step.code ?? "nothing"} can't be written for kanata; only modifiers can be held across steps`);
      if (step.op === "press") held.add(mod);
      else held.delete(mod);
    }
  }
  if (held.size > 0) throw new GenerateError(`macro "${m.name}" presses ${[...held].join("+")} and never releases it`);
  return items.length === 0 ? "(macro)" : `(macro ${items.join(" ")})`;
}

const MOD_OF_KEY: Record<string, Mod> = {
  LEFT_CTRL: "LCTL", LEFT_SHIFT: "LSFT", LEFT_ALT: "LALT", LEFT_GUI: "LGUI", RIGHT_CTRL: "RCTL", RIGHT_SHIFT: "RSFT", RIGHT_ALT: "RALT", RIGHT_GUI: "RGUI",
};

