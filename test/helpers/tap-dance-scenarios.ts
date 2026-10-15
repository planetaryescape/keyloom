// The key scripts S16 runs every tap dance through, on QMK and on ZMK: each slot Oryx has, and the ways a dance is cut short.
import type { EmulatorEvent, EmulatorReport } from "../../src/firmware/emulate/types.ts";

/** Time between scenarios in one emulator run, long enough for any dance to finish and reset. */
export const GAP = 6000;

type Step = { at: number; key: "td" | "other"; action: "press" | "release" };
const P = (at: number, key: Step["key"] = "td"): Step => ({ at, key, action: "press" });
const R = (at: number, key: Step["key"] = "td"): Step => ({ at, key, action: "release" });

/** The key scripts every tap dance is run through: each slot Oryx has, and the ways a dance is cut short. */
export const SCENARIOS: Array<{ name: string; steps: Step[] }> = [
  { name: "tap", steps: [P(0), R(40)] },
  { name: "double-tap", steps: [P(0), R(40), P(120), R(160)] },
  { name: "hold", steps: [P(0), R(600)] },
  { name: "tap then hold", steps: [P(0), R(40), P(120), R(700)] },
  { name: "triple tap", steps: [P(0), R(40), P(120), R(160), P(240), R(280)] },
  { name: "quadruple tap", steps: [P(0), R(40), P(120), R(160), P(240), R(280), P(360), R(400)] },
  { name: "tap, then another key", steps: [P(0), R(40), P(100, "other"), R(140, "other")] },
  { name: "double-tap, then another key", steps: [P(0), R(40), P(120), R(160), P(220, "other"), R(260, "other")] },
  { name: "hold, another key pressed meanwhile", steps: [P(0), P(100, "other"), R(140, "other"), R(300)] },
  { name: "tap, wait out the term, tap again", steps: [P(0), R(40), P(500), R(540)] },
];


/** Every scenario for each key, back to back with a gap that lets the firmware settle, as one emulator run. `other` is a second key for the scenarios that press one. */
export function plan(keys: number[], other: number): { events: EmulatorEvent[]; windows: Array<{ key: number; name: string; from: number }> } {
  const events: EmulatorEvent[] = [];
  const windows: Array<{ key: number; name: string; from: number }> = [];
  let from = 0;
  for (const key of keys) {
    for (const s of SCENARIOS) {
      windows.push({ key, name: s.name, from });
      for (const step of s.steps) events.push({ at: from + step.at, position: step.key === "td" ? key : other, action: step.action });
      from += GAP;
    }
  }
  return { events, windows };
}

/** The reports of each scenario, with times from that scenario's start, under "<label>: <scenario>". */
export function split(reports: EmulatorReport[], windows: ReturnType<typeof plan>["windows"], label: (key: number) => string): Record<string, EmulatorReport[]> {
  const out: Record<string, EmulatorReport[]> = {};
  windows.forEach((w, i) => {
    const end = windows[i + 1]?.from ?? Number.POSITIVE_INFINITY;
    out[`${label(w.key)}: ${w.name}`] = reports.filter((r) => r.at >= w.from && r.at < end).map((r) => ({ ...r, at: r.at - w.from }));
  });
  return out;
}
