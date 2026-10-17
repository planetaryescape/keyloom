// S33: the same home-row-mod key events through keyloom's QMK emulator (BK's Moonlander layout, real QMK core in Docker)
// and through kanata's simulator (the MacBook layout keyloom generates for the translated profile). Both sides are driven
// from the scenarios and option sets below, so a difference is a property of the option, not of the input.
// The QMK side needs Docker, so `scripts/record-hrm-qmk.ts` records it to test/fixtures/kanata-sim/qmk.json; the gated test
// (test/firmware/kanata/sim.test.ts) replays kanata only.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { translateHoldTapProfile } from "../../src/layout/kanata/profiles.ts";
import { generateKanataSource } from "../../src/firmware/kanata/generate.ts";
import { identityLayout } from "../../src/firmware/kanata/identity.ts";
import type { Binding, FirmwareSetting, HoldTapProfile, Layout } from "../../src/layout/schema.ts";
import { at, macbook, withBindings } from "./macbook.ts";

export type Mod = "LGUI" | "LALT" | "LCTL" | "LSFT" | "RGUI" | "RALT" | "RCTL" | "RSFT";

/** The keys the scenarios press: a letter, its KeyCode name, its position on BK's Moonlander base layer, and the hold it has (if home-row). */
export const KEYS: Record<string, { code: string; moonlander: number; hold?: Mod }> = {
  A: { code: "A", moonlander: 29, hold: "LGUI" },
  S: { code: "S", moonlander: 30, hold: "LALT" },
  D: { code: "D", moonlander: 31, hold: "LCTL" },
  F: { code: "F", moonlander: 32, hold: "LSFT" },
  J: { code: "J", moonlander: 37, hold: "RSFT" },
  K: { code: "K", moonlander: 38, hold: "RCTL" },
  L: { code: "L", moonlander: 39, hold: "RALT" },
  E: { code: "E", moonlander: 17 }, // left hand, plain
  U: { code: "U", moonlander: 23 }, // right hand, plain
  C: { code: "C", moonlander: 45 },
};

export type Step = readonly [key: string, action: "d" | "u", at: number];
export type Scenario = { id: string; what: string; steps: readonly Step[] };

const tap = (key: string, from: number, ms = 40): Step[] => [[key, "d", from], [key, "u", from + ms]];

/** Times are ms from the scenario's first event. The tapping term in every option set is 200. */
export const SCENARIOS: readonly Scenario[] = [
  { id: "tap-alone", what: "S tapped for 80 ms", steps: [["S", "d", 0], ["S", "u", 80]] },
  { id: "hold-alone", what: "S held 400 ms, nothing else", steps: [["S", "d", 0], ["S", "u", 400]] },
  { id: "roll-same-hand", what: "S down, E down at 50, S up at 90, E up at 120 (a roll on one hand)", steps: [["S", "d", 0], ["E", "d", 50], ["S", "u", 90], ["E", "u", 120]] },
  { id: "roll-opposite-hand", what: "S down, U down at 50, S up at 90, U up at 120 (a roll across hands)", steps: [["S", "d", 0], ["U", "d", 50], ["S", "u", 90], ["U", "u", 120]] },
  { id: "nested-same-hand", what: "S down, E tapped 50-90 inside it, S up at 150", steps: [["S", "d", 0], ...tap("E", 50), ["S", "u", 150]] },
  { id: "nested-opposite-hand", what: "S down, U tapped 50-90 inside it, S up at 150", steps: [["S", "d", 0], ...tap("U", 50), ["S", "u", 150]] },
  { id: "other-key-then-term", what: "S down, U down at 100 and held past the term, U up at 250, S up at 300", steps: [["S", "d", 0], ["U", "d", 100], ["U", "u", 250], ["S", "u", 300]] },
  { id: "same-hand-past-term", what: "S down, E down at 100 and held past the term, E up at 250, S up at 300", steps: [["S", "d", 0], ["E", "d", 100], ["E", "u", 250], ["S", "u", 300]] },
  { id: "other-key-after-term", what: "S down, U tapped 250-290 after the term, S up at 400", steps: [["S", "d", 0], ...tap("U", 250), ["S", "u", 400]] },
  { id: "quick-retap", what: "S tapped 0-50, pressed again at 100 and held to 500", steps: [...tap("S", 0, 50), ["S", "d", 100], ["S", "u", 500]] },
  { id: "flow-typing", what: "E tapped 0-40, then S down at 80 and held to 400", steps: [...tap("E", 0), ["S", "d", 80], ["S", "u", 400]] },
  { id: "flow-then-key", what: "E tapped 0-40, S down at 80, U tapped 120-160, S up at 220", steps: [...tap("E", 0), ["S", "d", 80], ...tap("U", 120), ["S", "u", 220]] },
  { id: "two-hrm-roll", what: "S down, J down at 30, S up at 80, J up at 110 (two home-row mods rolled)", steps: [["S", "d", 0], ["J", "d", 30], ["S", "u", 80], ["J", "u", 110]] },
  { id: "slow-retap", what: "S tapped 0-50, pressed again at 160 (inside the 200 ms term, past 120) and held to 560", steps: [...tap("S", 0, 50), ["S", "d", 160], ["S", "u", 560]] },
  { id: "shift-chord", what: "F down, U tapped 50-90, F up at 150 (Shift+U)", steps: [["F", "d", 0], ...tap("U", 50), ["F", "u", 150]] },
];

export type OptionSet = { id: string; qmk: Record<string, boolean | number> };

/** The QMK options keyloom maps to kanata variants (D-242). TAPPING_TERM is 200 throughout. */
export const OPTION_SETS: readonly OptionSet[] = [
  { id: "plain", qmk: {} },
  { id: "permissive-hold", qmk: { PERMISSIVE_HOLD: true } },
  { id: "hold-on-other-key-press", qmk: { HOLD_ON_OTHER_KEY_PRESS: true } },
  { id: "both-permissive-and-hold-on-other", qmk: { PERMISSIVE_HOLD: true, HOLD_ON_OTHER_KEY_PRESS: true } },
  { id: "chordal-hold", qmk: { CHORDAL_HOLD: true } },
  { id: "chordal-hold-hold-on-other", qmk: { CHORDAL_HOLD: true, HOLD_ON_OTHER_KEY_PRESS: true } },
  { id: "chordal-hold-permissive", qmk: { CHORDAL_HOLD: true, PERMISSIVE_HOLD: true } },
  { id: "quick-tap-120", qmk: { QUICK_TAP_TERM: 120 } },
  { id: "flow-tap-150", qmk: { FLOW_TAP_TERM: 150 } },
  { id: "flow-tap-150-permissive", qmk: { FLOW_TAP_TERM: 150, PERMISSIVE_HOLD: true } },
];

/** Quiet time between scenarios, past every term and the longest settle, so one never leaks into the next. */
export const GAP_MS = 2000;

/** All scenarios as one event list, each starting at a multiple of GAP_MS. */
export function scenarioStarts(): Array<{ scenario: Scenario; start: number }> {
  return SCENARIOS.map((scenario, i) => ({ scenario, start: i * GAP_MS }));
}

const HOME = Object.entries(KEYS).filter(([, k]) => k.hold !== undefined);

export function qmkSettings(set: OptionSet): FirmwareSetting[] {
  return [{ firmware: "qmk", key: "TAPPING_TERM", value: 200 }, ...Object.entries(set.qmk).map(([key, value]) => ({ firmware: "qmk" as const, key, value }))];
}

/** BK's Moonlander layout with home-row mods on the eight home keys and the option set as layout-wide settings. */
export function moonlanderLayout(base: Layout, set: OptionSet): Layout {
  const tapHold = new Set(["TAPPING_TERM", "PERMISSIVE_HOLD", "CHORDAL_HOLD", "FLOW_TAP_TERM", "QUICK_TAP_TERM", "HOLD_ON_OTHER_KEY_PRESS"]);
  const profile: HoldTapProfile = { id: "hrm", name: "Home-row mods", firmware: "qmk", options: {} };
  const baseLayer = base.layers[0]!;
  const bindings = baseLayer.bindings.map((b, p): Binding => {
    const hit = HOME.find(([, k]) => k.moonlander === p);
    if (!hit) return b.kind === "holdTap" ? { kind: "key", code: b.tap.code } : b;
    return { kind: "holdTap", tap: { code: hit[1].code }, hold: { mods: [hit[1].hold as Mod] }, profileId: "hrm" };
  });
  return {
    ...base,
    // BK's Moonlander combines S and D (among others), and QMK holds a combo key back for COMBO_TERM (50 ms) in case the
    // other half follows, which put 51 ms on every tap QMK decided at the press. The MacBook has no such combos.
    combos: [],
    settings: [...base.settings.filter((s) => !(s.firmware === "qmk" && tapHold.has(s.key))), ...qmkSettings(set)],
    // The layout's other profiles stay, with nothing of their own to disagree with the layout-wide settings.
    holdTapProfiles: [profile, ...base.holdTapProfiles.filter((p) => p.id !== "hrm").map((p) => ({ ...p, options: {} }))],
    layers: [{ ...baseLayer, bindings }, ...base.layers.slice(1)],
  };
}

/** The MacBook layout keyloom writes for the same options: the QMK profile through D-242's translation, then the kanata generator. */
export function macbookLayout(set: OptionSet): { layout: Layout; kanataProfile: HoldTapProfile; notes: string[] } {
  const qmk: HoldTapProfile = { id: "hrm", name: "Home-row mods", firmware: "qmk", options: {} };
  const { profile, notes } = translateHoldTapProfile(qmk, qmkSettings(set));
  const set_: Record<string, Binding> = {};
  for (const [, k] of HOME) set_[k.code] = { kind: "holdTap", tap: { code: k.code }, hold: { mods: [k.hold as Mod] }, profileId: "hrm" };
  const layout = { ...withBindings(identityLayout(macbook()), "base", set_), holdTapProfiles: [profile] };
  return { layout, kanataProfile: profile, notes };
}

export function kanataConfig(set: OptionSet): { kbd: string; kanataProfile: HoldTapProfile; notes: string[] } {
  const { layout, kanataProfile, notes } = macbookLayout(set);
  const src = generateKanataSource({ layout, board: macbook(), layoutId: "lay_S33", revisionId: "rev_S33" });
  return { kbd: src.files.find((f) => f.path === "keyloom.kbd")!.content, kanataProfile, notes };
}

// --- kanata side ----------------------------------------------------------------------------------------------

const KANATA_KEY: Record<string, string> = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, v.code.toLowerCase()]));

/** sim.txt for one scenario: kanata's input is `d:key`, `u:key` and `t:ms` between them. */
export function simText(scenario: Scenario): string {
  const out: string[] = [];
  let now = 0;
  for (const [key, action, ms] of [...scenario.steps].sort((a, b) => a[2] - b[2])) {
    if (ms > now) out.push(`t:${ms - now}`);
    now = ms;
    out.push(`${action}:${KANATA_KEY[key]}`);
  }
  out.push("t:1500"); // lets a pending tap-hold time out
  return `${out.join(" ")}\n`;
}

export type OutEvent = { at: number; key: string; action: "d" | "u" };

const KANATA_OUT: Record<string, string> = {
  LAlt: "LALT", RAlt: "RALT", LShift: "LSFT", RShift: "RSFT", LCtrl: "LCTL", RCtrl: "RCTL", LMeta: "LGUI", RMeta: "RGUI",
};

/** kanata_simulated_input prints `t:<ms since the last output>` then `out:↓Key` / `out:↑Key`. The table after them is ignored. */
export function parseSim(stdout: string): OutEvent[] {
  const events: OutEvent[] = [];
  let at = 0;
  for (const line of stdout.split("\n")) {
    const t = /^t:(\d+)ms$/.exec(line);
    if (t) { at += Number(t[1]); continue; }
    const o = /^out:([↓↑])(\S+)$/.exec(line);
    if (o) events.push({ at, key: KANATA_OUT[o[2] as string] ?? (o[2] as string).toUpperCase(), action: o[1] === "↓" ? "d" : "u" });
  }
  return events;
}

export type State = { at: number; mods: string[]; keys: string[] };

/** The HID-report-like state after each output event, so kanata's key-at-a-time output compares with QMK's reports. */
export function toStates(events: OutEvent[]): State[] {
  const mods = new Set<string>();
  const keys = new Set<string>();
  const states: State[] = [];
  for (const e of events) {
    const set = e.key in { LALT: 1, RALT: 1, LSFT: 1, RSFT: 1, LCTL: 1, RCTL: 1, LGUI: 1, RGUI: 1 } ? mods : keys;
    if (e.action === "d") set.add(e.key); else set.delete(e.key);
    states.push({ at: e.at, mods: [...mods].sort(), keys: [...keys].sort() });
  }
  return states;
}

/** Drops states that repeat the one before, as the QMK emulator does for its reports. */
export function dedupe(states: State[]): State[] {
  return states.filter((s, i) => i === 0 || JSON.stringify([s.mods, s.keys]) !== JSON.stringify([states[i - 1]!.mods, states[i - 1]!.keys]));
}

/** `+LALT`, `S`, `-S`, `-LALT`: what each state adds or removes, which reads like the typing. */
export function describe(states: State[]): string {
  let prev: State = { at: 0, mods: [], keys: [] };
  const parts: string[] = [];
  for (const s of states) {
    const add = [...s.mods, ...s.keys].filter((k) => ![...prev.mods, ...prev.keys].includes(k));
    const del = [...prev.mods, ...prev.keys].filter((k) => ![...s.mods, ...s.keys].includes(k));
    parts.push([...add.map((k) => `+${k}`), ...del.map((k) => `-${k}`)].join(" ") + `@${Math.round(s.at)}`);
    prev = s;
  }
  return parts.join(" ");
}

/** Runs the simulator on a config and a scenario in a scratch directory; kanata reads the script and nothing else. */
export function runSim(sim: string, kbd: string, scenario: Scenario, dir: string): State[] {
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, "keyloom.kbd");
  const txt = join(dir, `${scenario.id}.txt`);
  writeFileSync(cfg, kbd);
  writeFileSync(txt, simText(scenario));
  const r = spawnSync(sim, ["-c", cfg, "-s", txt], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`kanata_simulated_input failed on ${scenario.id}: ${r.stderr || r.stdout}`);
  return dedupe(toStates(parseSim(r.stdout)));
}

/** What the typist gets: each key that goes down, with the modifiers down at that moment (`LALT+U`, `S`). */
export function typed(states: State[]): string[] {
  const out: string[] = [];
  let prev: State = { at: 0, mods: [], keys: [] };
  for (const s of states) {
    for (const k of s.keys) if (!prev.keys.includes(k)) out.push([...s.mods, k].join("+"));
    prev = s;
  }
  return out;
}

/** Two states differ in time by less than this on both sides at once, and kanata's own output lag (~6 ms) is inside it. */
export const TIMING_TOLERANCE_MS = 10;

export type Verdict =
  | { kind: "match" }
  | { kind: "timing"; maxMs: number }
  | { kind: "order" }
  | { kind: "differs" };

/** `match`: the same reports within the tolerance. `timing`: the same reports, later or earlier. `order`: the same keys typed, reports in another order. `differs`: not the same typing. */
export function compare(qmk: State[], kanata: State[]): Verdict {
  const same = qmk.length === kanata.length && qmk.every((s, i) => JSON.stringify([s.mods, s.keys]) === JSON.stringify([kanata[i]!.mods, kanata[i]!.keys]));
  if (same) {
    const maxMs = Math.max(0, ...qmk.map((s, i) => Math.abs(s.at - kanata[i]!.at)));
    return maxMs <= TIMING_TOLERANCE_MS ? { kind: "match" } : { kind: "timing", maxMs };
  }
  return JSON.stringify(typed(qmk)) === JSON.stringify(typed(kanata)) ? { kind: "order" } : { kind: "differs" };
}
