// The picker's Macro tab as plain data (16#macros-are-made-in-the-picker-and-each-pick-adds-a-step, D-088):
// steps are keys with modifiers or typed text, each with an optional wait after it, and the builder
// turns them into the model's Macro. Pure, so the builder is tested without a browser.
import { tapText } from "../../layout/render-grid.ts";
import type { Layout, Macro, MacroStep, Mod } from "../../layout/schema.ts";
import { sortMods } from "../editor/draft.ts";

export type BuilderStep =
  | { kind: "key"; code: string; mods: Mod[]; waitMs: number }
  | { kind: "text"; text: string; waitMs: number };

export interface Builder {
  /** The macro being edited; null for a new one. */
  id: string | null;
  name: string;
  /** False while the name is the generated one, so it follows the steps. */
  nameTouched: boolean;
  steps: BuilderStep[];
}

export const emptyBuilder = (): Builder => ({ id: null, name: "", nameTouched: false, steps: [] });

/** The builder for an existing macro, or null if it has steps the builder can't show (press, release, a wait first). */
export function builderFromMacro(macro: Macro): Builder | null {
  const steps: BuilderStep[] = [];
  for (const step of macro.steps) {
    if (step.op === "tap" && step.code !== undefined) steps.push({ kind: "key", code: step.code, mods: sortMods(step.mods ?? []), waitMs: 0 });
    else if (step.op === "text") steps.push({ kind: "text", text: step.text, waitMs: 0 });
    else if (step.op === "waitMs") {
      const last = steps.at(-1);
      if (last === undefined) return null;
      last.waitMs += step.ms;
    } else return null;
  }
  const builder: Builder = { id: macro.id, name: macro.name, nameTouched: false, steps };
  return { ...builder, nameTouched: macro.name !== generatedName(steps) };
}

export const addKey = (b: Builder, code: string, mods: readonly Mod[]): Builder => ({ ...b, steps: [...b.steps, { kind: "key", code, mods: sortMods(mods), waitMs: 0 }] });

export const addText = (b: Builder, text: string): Builder => (text === "" ? b : { ...b, steps: [...b.steps, { kind: "text", text, waitMs: 0 }] });

function replaceAt(b: Builder, index: number, change: (step: BuilderStep) => BuilderStep): Builder {
  return { ...b, steps: b.steps.map((step, i) => (i === index ? change(step) : step)) };
}

export const setWait = (b: Builder, index: number, ms: number): Builder => replaceAt(b, index, (step) => ({ ...step, waitMs: Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0)) }));

export const setStepMods = (b: Builder, index: number, mods: readonly Mod[]): Builder =>
  replaceAt(b, index, (step) => (step.kind === "key" ? { ...step, mods: sortMods(mods) } : step));

export const removeStep = (b: Builder, index: number): Builder => ({ ...b, steps: b.steps.filter((_, i) => i !== index) });

export function moveStep(b: Builder, index: number, by: -1 | 1): Builder {
  const to = index + by;
  if (to < 0 || to >= b.steps.length) return b;
  const steps = [...b.steps];
  const [moved] = steps.splice(index, 1);
  steps.splice(to, 0, moved as BuilderStep);
  return { ...b, steps };
}

export const rename = (b: Builder, name: string): Builder => ({ ...b, name, nameTouched: name.trim() !== "" });

// What a chord is called when it is part of a macro's name. Ctrl stands in for Command on other systems.
const CHORD_NAMES: Readonly<Record<string, string>> = {
  C: "Copy", V: "Paste", X: "Cut", Z: "Undo", A: "Select all", S: "Save", F: "Find", W: "Close", T: "New tab", N: "New", R: "Reload", P: "Print",
};
const SWITCH_KEYS = new Set(["TAB"]);

function stepName(step: BuilderStep): string {
  if (step.kind === "text") {
    const text = step.text.replace(/\s+/g, " ").trim();
    return `Type "${text.length > 16 ? `${text.slice(0, 15)}…` : text}"`;
  }
  const command = step.mods.includes("LGUI") || step.mods.includes("LCTL") || step.mods.includes("RGUI") || step.mods.includes("RCTL");
  if (command && SWITCH_KEYS.has(step.code)) return "switch";
  if (command && step.mods.length === 1 && Object.hasOwn(CHORD_NAMES, step.code)) return CHORD_NAMES[step.code] as string;
  return tapText(step.code, step.mods);
}

/** "Copy, switch, paste": the name a macro gets from its steps until the person names it. */
export function generatedName(steps: readonly BuilderStep[]): string {
  if (steps.length === 0) return "New macro";
  const words = steps.map(stepName);
  return words.map((word, i) => (i === 0 ? word : word.charAt(0).toLowerCase() + word.slice(1))).join(", ");
}

/** "Sends ⌘C, then ⌘Tab, waits 100 ms, then ⌘V": the macro read back in words. */
export function summary(steps: readonly BuilderStep[]): string {
  if (steps.length === 0) return "Nothing yet. Add keys or type some text.";
  const parts: string[] = [];
  steps.forEach((step, i) => {
    const what = step.kind === "text" ? `types "${step.text}"` : tapText(step.code, step.mods);
    parts.push(i === 0 ? (step.kind === "text" ? `Types "${step.text}"` : `Sends ${what}`) : `then ${what}`);
    if (step.waitMs > 0) parts.push(`waits ${step.waitMs} ms`);
  });
  return parts.join(", ");
}

/** The model's steps: each key a tap, each wait its own step. */
export function toSteps(steps: readonly BuilderStep[]): MacroStep[] {
  return steps.flatMap((step): MacroStep[] => [
    step.kind === "key" ? { op: "tap", code: step.code, ...(step.mods.length ? { mods: step.mods } : {}) } : { op: "text", text: step.text },
    ...(step.waitMs > 0 ? [{ op: "waitMs" as const, ms: step.waitMs }] : []),
  ]);
}

/** A name no other macro in the layout has, so two macros are told apart in the library. */
function freeName(name: string, layout: Layout, pending: readonly Macro[], ownId: string | null): string {
  const used = new Set([...layout.macros, ...pending].filter((m) => m.id !== ownId).map((m) => m.name));
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

function freeId(layout: Layout, pending: readonly Macro[]): string {
  const used = new Set([...layout.macros, ...pending].map((m) => m.id));
  let n = layout.macros.length + 1;
  while (used.has(`macro-${n}`)) n++;
  return `macro-${n}`;
}

/** The macro the builder stands for. `id` overrides the builder's own (a copy for one key gets a new one). */
export function toMacro(b: Builder, layout: Layout, pending: readonly Macro[] = [], id: string | null = b.id): Macro | null {
  if (b.steps.length === 0) return null;
  const wanted = b.nameTouched && b.name.trim() !== "" ? b.name.trim() : generatedName(b.steps);
  const own = id ?? freeId(layout, pending);
  return { id: own, name: freeName(wanted, layout, pending, own), steps: toSteps(b.steps) };
}

const MODIFIER_WORDS: ReadonlyArray<[RegExp, Mod]> = [
  [/^(?:cmd|command|gui|win|super|⌘)/i, "LGUI"],
  [/^(?:ctrl|control|⌃)/i, "LCTL"],
  [/^(?:alt|opt|option|⌥)/i, "LALT"],
  [/^(?:shift|⇧)/i, "LSFT"],
];

/**
 * "cmd c", "⌘+tab" or "⌘c": leading modifier words become modifiers and the rest is the key to search for, so
 * a chord is one pick instead of a modifier click and a key click.
 */
export function parseChordQuery(query: string): { mods: Mod[]; rest: string } {
  const mods: Mod[] = [];
  let rest = query.trimStart();
  for (let progressed = true; progressed; ) {
    progressed = false;
    for (const [pattern, mod] of MODIFIER_WORDS) {
      const match = pattern.exec(rest);
      if (match === null) continue;
      const after = rest.slice(match[0].length);
      const symbol = /^[⌘⌃⌥⇧]/.test(match[0]);
      // A word modifier needs a separator or the end ("cmd c", "cmd+c"); a symbol can sit against its key ("⌘c").
      const separated = /^(?:\s*\+\s*|\s+|$)/.exec(after);
      if (!symbol && separated === null) continue;
      mods.push(mod);
      rest = separated === null ? after : after.slice(separated[0].length);
      progressed = true;
      break;
    }
  }
  return { mods: sortMods(mods), rest: rest.trim() };
}
