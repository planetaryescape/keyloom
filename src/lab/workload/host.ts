// A deliberately small US host adapter. This maps intent and checks HID; it does not execute firmware semantics.
import type { EmulatorReport } from "../../firmware/emulate/types.ts";
import type { WorkloadTask } from "./schema.ts";

const PUNCTUATION = [
  ["MINUS", "-", "_"], ["EQUAL", "=", "+"], ["LEFT_BRACKET", "[", "{"], ["RIGHT_BRACKET", "]", "}"],
  ["BACKSLASH", "\\", "|"], ["SEMICOLON", ";", ":"], ["QUOTE", "'", '"'], ["GRAVE", "`", "~"],
  ["COMMA", ",", "<"], ["DOT", ".", ">"], ["SLASH", "/", "?"],
] as const;
const characters = new Map<string, { key: string; shifted: boolean }>();
for (const [key, lower, upper] of PUNCTUATION) {
  characters.set(lower, { key, shifted: false }); characters.set(upper, { key, shifted: true });
}
for (let i = 0; i < 10; i++) {
  characters.set(String(i), { key: `N${i}`, shifted: false });
  characters.set(")!@#$%^&*(".charAt(i), { key: `N${i}`, shifted: true });
}
for (const [text, key] of [[" ", "SPACE"], ["\n", "ENTER"], ["\t", "TAB"]] as const) characters.set(text, { key, shifted: false });
for (const c of "abcdefghijklmnopqrstuvwxyz") {
  characters.set(c, { key: c.toUpperCase(), shifted: false }); characters.set(c.toUpperCase(), { key: c.toUpperCase(), shifted: true });
}
export type Goal = { key: string; modChoices: string[][] };
export function taskGoals(task: WorkloadTask): Goal[] | undefined {
  if (task.kind === "hid") return task.strokes.map((s) => ({ key: s.key, modChoices: [[...s.mods].sort()] }));
  const goals: Goal[] = [];
  for (const c of task.text) {
    const output = characters.get(c);
    if (!output) return undefined;
    goals.push({ key: output.key, modChoices: output.shifted ? [["LSFT"], ["RSFT"]] : [[]] });
  }
  return goals;
}
export const sameMods = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((m) => b.includes(m));
export type OutputVerification = { ok: boolean; reason: string | null; expected: Goal[]; actual: { key: string; mods: string[] }[]; finalHidReleased: boolean };

/** Every new keyboard key must match, in order, without edits, ignored unknown keys or shortcut modifiers leaking into text. */
export function verifyOutput(goals: Goal[], reports: readonly EmulatorReport[]): OutputVerification {
  const actual: { key: string; mods: string[] }[] = [];
  let down = new Set<string>();
  let finalMods: string[] = [];
  const usedModifiers = new Set<string>();
  let consumer: string[] = [];
  let reason: string | null = null;
  let previousAt = -Infinity;
  for (const report of reports) {
    if (!Number.isFinite(report.at) || report.at < 0 || report.at < previousAt) reason ??= "invalid report order";
    previousAt = report.at;
    if (report.kind === "consumer") {
      consumer = report.usages;
      if (consumer.length) reason ??= "unexpected consumer output";
      continue;
    }
    if (new Set(report.keys).size !== report.keys.length || new Set(report.mods).size !== report.mods.length) reason ??= "duplicate HID usage";
    // A modifier excursion that never accompanies a requested keydown is extra output too (for example an accidental GUI tap).
    for (const mod of finalMods) if (!report.mods.includes(mod)) {
      if (!usedModifiers.has(mod)) reason ??= "modifier activation was not used by a requested keydown";
      usedModifiers.delete(mod);
    }
    for (const mod of report.mods) if (!finalMods.includes(mod)) usedModifiers.delete(mod);
    const newlyDown = report.keys.filter((key) => !down.has(key));
    if (newlyDown.length > 1) reason ??= "simultaneous output keys have no declared ordering";
    if (report.keys.length > 1) reason ??= "overlapping output keys are outside the sequential host contract";
    for (const key of newlyDown) {
      const goal = goals[actual.length];
      actual.push({ key, mods: [...report.mods].sort() });
      for (const mod of report.mods) usedModifiers.add(mod);
      if (!goal || key !== goal.key || !goal.modChoices.some((mods) => sameMods(mods, report.mods))) reason ??= "wrong, extra or incorrectly modified keydown";
    }
    // Modifier-only states may prepare the next chord or release the last one, but may not add unrelated modifiers.
    if (newlyDown.length === 0) {
      const adjacent = [goals[actual.length - 1], goals[actual.length]].flatMap((g) => g?.modChoices ?? []);
      if (report.mods.length && !adjacent.some((mods) => report.mods.every((m) => mods.includes(m)))) reason ??= "unexpected modifier output";
      if (report.keys.length && !goals[actual.length - 1]?.modChoices.some((mods) => sameMods(mods, report.mods))) reason ??= "modifiers changed while output key held";
    }
    down = new Set(report.keys); finalMods = report.mods;
  }
  const finalHidReleased = down.size === 0 && finalMods.length === 0 && consumer.length === 0;
  if (!finalHidReleased) reason ??= "final HID output is still held";
  if (actual.length !== goals.length) reason ??= "partial or extra output";
  return { ok: reason === null, reason, expected: goals, actual, finalHidReleased };
}
