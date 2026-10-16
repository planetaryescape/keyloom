// What a recording says, in words a person reads (D-283): "Your right pinky causes most errors", "S→D rolls overlap by 40 ms". Each
// generator returns a finding with a weight, so the screen can show the one or two that matter and keep the rest one click away.
import type { BoardDefinition } from "../boards/schema.ts";
import { keyCodeLabel } from "../layout/keycodes.ts";
import type { Binding, Layout, Mod } from "../layout/schema.ts";
import type { Difference } from "./classify.ts";
import { holdModsOf } from "./intent.ts";
import { type FingerRow, type FingerStats, MIN_SAMPLES, keyCode } from "./stats.ts";

export type FindingKind = "errors-by-finger" | "slow-finger" | "same-finger" | "roll" | "mod-tap-hold" | "misfire";

export type Finding = {
  /** Steady across analyses of the same recording, so the screen can keep one open. */
  id: string;
  kind: FindingKind;
  /** Larger matters more. */
  weight: number;
  sentence: string;
  /** The numbers behind the sentence. */
  data: Record<string, number | string>;
};

const MOD_WORDS: Record<Mod, string> = { LCTL: "Control", RCTL: "Control", LSFT: "Shift", RSFT: "Shift", LALT: "Option", RALT: "Option", LGUI: "Command", RGUI: "Command" };
/** Modifiers as a Mac names them, since keyloom's person types on one. */
export const modPhrase = (mods: readonly Mod[]): string => [...new Set(mods.map((m) => MOD_WORDS[m]))].join(" + ");

const plainName = (code: string | undefined): string => {
  if (code === undefined) return "a key";
  const label = keyCodeLabel(code);
  return /^[A-Za-z0-9]/.test(label) ? label : code.toLowerCase().replaceAll("_", " ");
};

/** A key as a sentence names it: the letter it types, or its word. */
export const keyName = (layout: Layout, position: number): string => plainName(keyCode(layout, position));

/** "right pinky", from the board's finger names, which are already words. */
export const fingerName = (finger: string): string => finger.replaceAll("-", " ");

const pct = (x: number) => `${Math.round(x * 100)}%`;
const ms = (x: number) => `${Math.round(x)} ms`;

function errorFinding(rows: readonly FingerRow[], total: { presses: number; errors: number }): Finding | undefined {
  const overall = total.presses === 0 ? 0 : total.errors / total.presses;
  const worst = [...rows].filter((r) => r.errors >= 3).sort((a, b) => b.errors - a.errors || b.errorRate - a.errorRate)[0];
  // A finger earns the sentence by being worse than the rest, not by being the one that types the most.
  if (!worst || worst.errorRate < 1.5 * overall) return undefined;
  const share = total.errors === 0 ? 0 : worst.errors / total.errors;
  return {
    id: `errors:${worst.finger}`, kind: "errors-by-finger", weight: worst.errors * (worst.errorRate / Math.max(overall, 0.001)),
    sentence: `Your ${fingerName(worst.finger)} causes most errors: ${worst.errors} of its ${worst.attempts} keys went wrong (${pct(worst.errorRate)}), ${pct(share)} of all the errors.`,
    data: { finger: worst.finger, errors: worst.errors, attempts: worst.attempts, rate: worst.errorRate },
  };
}

function slowFinding(rows: readonly FingerRow[]): Finding | undefined {
  const usable = rows.filter((r) => r.interKey.n >= 15);
  if (usable.length < 3) return undefined;
  const slowest = [...usable].sort((a, b) => b.interKey.median - a.interKey.median)[0] as FingerRow;
  const others = usable.filter((r) => r !== slowest).map((r) => r.interKey.median).sort((a, b) => a - b);
  const typical = others[Math.floor(others.length / 2)] as number;
  if (slowest.interKey.median < typical * 1.25 || slowest.interKey.median - typical < 30) return undefined;
  return {
    id: `slow:${slowest.finger}`, kind: "slow-finger", weight: (slowest.interKey.median - typical) / 10,
    sentence: `You slow down on keys your ${fingerName(slowest.finger)} presses: ${ms(slowest.interKey.median)} to reach them, against ${ms(typical)} for your other fingers.`,
    data: { finger: slowest.finger, medianMs: slowest.interKey.median, typicalMs: typical },
  };
}

export function sentencesFor(input: { stats: FingerStats; layout: Layout; board: BoardDefinition; differences: readonly Difference[] }): Finding[] {
  const { stats, layout } = input;
  const found: Array<Finding | undefined> = [errorFinding(stats.fingers, stats), slowFinding(stats.fingers)];

  const typical = stats.interKey.median;
  for (const pair of stats.sameFinger) {
    if (pair.interKey.n < MIN_SAMPLES || pair.interKey.median < typical * 1.3 || pair.interKey.median - typical < 40) continue;
    found.push({
      id: `same:${pair.from}>${pair.to}`, kind: "same-finger", weight: (pair.interKey.median - typical) / 10,
      sentence: `${keyName(layout, pair.from)}→${keyName(layout, pair.to)} is one finger (your ${fingerName(pair.finger)}) doing two jobs, and it takes ${ms(pair.interKey.median)}, ${ms(pair.interKey.median - typical)} longer than a usual step.`,
      data: { from: pair.from, to: pair.to, medianMs: pair.interKey.median, typicalMs: typical },
    });
  }

  const bindings = layout.layers[0]?.bindings ?? [];
  for (const row of stats.rolls) {
    if (row.rolls < MIN_SAMPLES || row.overlap.median < 10) continue;
    const first = bindings[row.from] as Binding | undefined;
    const mods = holdModsOf(first);
    const holdRow = stats.holds.find((h) => h.position === row.from);
    const term = holdRow?.termMs;
    // A roll matters when the first key is a mod-tap: the overlap is time the firmware has to decide between a roll and a hold.
    const consequence = mods !== undefined ? `; ${keyName(layout, row.from)} is a ${modPhrase(mods)} key, so that is when ${modPhrase(mods)} can fire${term === undefined ? "" : ` (its tapping term is ${term} ms)`}` : "";
    found.push({
      id: `roll:${row.from}>${row.to}`, kind: "roll", weight: (mods !== undefined ? 6 : 1) + row.rolls / 10,
      sentence: `${keyName(layout, row.from)}→${keyName(layout, row.to)} rolls overlap by ${ms(row.overlap.median)} (${row.rolls} of ${row.n} times)${consequence}.`,
      data: { from: row.from, to: row.to, rolls: row.rolls, n: row.n, overlapMs: row.overlap.median },
    });
  }

  for (const row of stats.holds) {
    const b = bindings[row.position];
    const mods = holdModsOf(b);
    if (mods === undefined || row.termMs === undefined || row.taps.n < MIN_SAMPLES || row.nearTerm === 0) continue;
    found.push({
      id: `hold:${row.position}`, kind: "mod-tap-hold", weight: 3 + row.nearTerm,
      sentence: `When you tap ${keyName(layout, row.position)} you hold it ${ms(row.taps.median)} (${ms(row.taps.p90)} at its slowest tenth); ${row.nearTerm} of ${row.taps.n} taps came within ${ms(row.termMs * 0.2)} of its ${row.termMs} ms tapping term, where it turns into ${modPhrase(mods)}.`,
      data: { position: row.position, tapMedianMs: row.taps.median, tapP90Ms: row.taps.p90, termMs: row.termMs, nearTerm: row.nearTerm },
    });
  }

  const misfires = input.differences.filter((d) => d.kind === "misfire-hold" || d.kind === "misfire-tap");
  const byKey = new Map<number, { hold: number; tap: number }>();
  for (const d of misfires) {
    const row = byKey.get(d.position as number) ?? { hold: 0, tap: 0 };
    if (d.kind === "misfire-hold") row.hold++;
    else row.tap++;
    byKey.set(d.position as number, row);
  }
  for (const [position, row] of byKey) {
    const mods = holdModsOf(bindings[position]);
    const name = keyName(layout, position);
    if (row.hold >= 2) {
      const rolls = misfires.filter((d) => d.position === position && d.kind === "misfire-hold" && (d.facts?.overlapMs ?? 0) > 0);
      const median = rolls.length === 0 ? 0 : [...rolls.map((d) => d.facts?.overlapMs ?? 0)].sort((a, b) => a - b)[Math.floor(rolls.length / 2)] as number;
      found.push({
        id: `misfire-hold:${position}`, kind: "misfire", weight: 10 + row.hold * 2,
        sentence: `${mods ? modPhrase(mods) : "The hold"} fired ${row.hold} times when you meant to type ${name}${rolls.length > 0 ? `, ${rolls.length} of them in a roll where ${name} was still down ${ms(median)} after the next key` : ""}.`,
        data: { position, count: row.hold, rolls: rolls.length },
      });
    }
    if (row.tap >= 2) {
      found.push({
        id: `misfire-tap:${position}`, kind: "misfire", weight: 10 + row.tap * 2,
        sentence: `${name} typed its letter ${row.tap} times when you held it for ${mods ? modPhrase(mods) : "its other job"}.`,
        data: { position, count: row.tap },
      });
    }
  }

  return found.filter((f): f is Finding => f !== undefined).sort((a, b) => b.weight - a.weight);
}
