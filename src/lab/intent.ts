// What a passage asks the hands to do, key by key, so a recording can be compared with it. A character becomes the positions that type it
// on the base layer; a "hold" step becomes a held mod-tap key and a key pressed while it is down.
import type { BoardDefinition } from "../boards/schema.ts";
import type { Binding, Layout, Mod } from "../layout/schema.ts";
import type { Passage } from "./passage-types.ts";

export type Step = {
  /** Position in the list of steps. */
  index: number;
  /** Every position that types it: a character on both a thumb key and another has two. */
  positions: number[];
  intent: "tap" | "hold";
  /** The modifiers a held key must put on the next key; set for "hold". */
  holdMods?: Mod[];
};

export type IntentResult = { steps: Step[]; skipped: string[] };

/** The key code a character is typed with on a US layout, unshifted. Capitals are typed as their letter: the lab asks for lower case. */
export function codeOfChar(ch: string): string | undefined {
  const c = ch.toLowerCase();
  if (/^[a-z]$/.test(c)) return c.toUpperCase();
  if (/^[1-9]$/.test(c)) return `N${c}`;
  const named: Record<string, string> = {
    "0": "N0", " ": "SPACE", ",": "COMMA", ".": "DOT", ";": "SEMICOLON", "'": "QUOTE", "/": "SLASH", "-": "MINUS", "=": "EQUAL", "\n": "ENTER", "\t": "TAB",
    "[": "LEFT_BRACKET", "]": "RIGHT_BRACKET", "\\": "BACKSLASH", "`": "GRAVE",
  };
  return named[c];
}

/** What a binding types when tapped, as a key code, or undefined for a binding that types nothing by itself. */
export function tapCodeOf(b: Binding | undefined): string | undefined {
  if (b === undefined) return undefined;
  if (b.kind === "key") return b.mods === undefined ? b.code : undefined;
  if (b.kind === "holdTap") return b.tap.mods === undefined ? b.tap.code : undefined;
  return undefined;
}

export const holdModsOf = (b: Binding | undefined): Mod[] | undefined => (b?.kind === "holdTap" && "mods" in b.hold ? b.hold.mods : undefined);

/** Positions on the base layer by the code they type when tapped. */
export function positionsByCode(layout: Layout): Map<string, number[]> {
  const found = new Map<string, number[]>();
  for (const [position, b] of (layout.layers[0]?.bindings ?? []).entries()) {
    const code = tapCodeOf(b);
    if (code !== undefined) found.set(code, [...(found.get(code) ?? []), position]);
  }
  return found;
}

export function intentSteps(passage: Passage, layout: Layout, _board: BoardDefinition): IntentResult {
  const where = positionsByCode(layout);
  const steps: Step[] = [];
  const skipped: string[] = [];
  const push = (positions: number[], intent: Step["intent"], holdMods?: Mod[]) => steps.push({ index: steps.length, positions, intent, ...(holdMods ? { holdMods } : {}) });
  const bindings = layout.layers[0]?.bindings ?? [];

  for (const step of passage.steps) {
    if (step.kind === "text") {
      for (const ch of step.text) {
        if (ch === "\r") continue;
        const code = codeOfChar(ch);
        const positions = code === undefined ? undefined : where.get(code);
        if (positions === undefined) {
          if (!skipped.includes(ch)) skipped.push(ch);
          continue;
        }
        push(positions, "tap");
      }
      continue;
    }
    const holderCode = codeOfChar(step.key);
    const thenCode = codeOfChar(step.then);
    const holders = (holderCode ? (where.get(holderCode) ?? []) : []).filter((p) => holdModsOf(bindings[p]) !== undefined);
    const targets = thenCode ? where.get(thenCode) : undefined;
    const mods = holders.length > 0 ? holdModsOf(bindings[holders[0] as number]) : undefined;
    if (holders.length === 0 || targets === undefined || mods === undefined) {
      skipped.push(`hold ${step.key}+${step.then}`);
      continue;
    }
    push(holders, "hold", mods);
    push(targets, "tap");
  }
  return { steps, skipped };
}
