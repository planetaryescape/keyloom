// Per-finger numbers from a recording (D-283), using the board's own idea of which finger presses which key: inter-key time, error rate,
// same-finger pairs, roll overlap and how long mod-tap keys are held. The numbers are plain; sentences.ts says them in words.
import type { BoardDefinition } from "../boards/schema.ts";
import type { Layout } from "../layout/schema.ts";
import type { Aligned } from "./align.ts";
import type { Difference } from "./classify.ts";
import { holdModsOf, tapCodeOf } from "./intent.ts";
import type { Press } from "./presses.ts";

/** A gap between two key presses longer than this is a pause (a word, a thought), not a transition between fingers. */
export const PAUSE_MS = 1000;
/** Rolls and same-finger pairs need this many examples before they are reported; fewer are noise. */
export const MIN_SAMPLES = 3;

export type Spread = { n: number; median: number; p90: number };

export function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { n: 0, median: 0, p90: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))] as number;
  return { n: sorted.length, median: at(0.5), p90: at(0.9) };
}

export type FingerRow = {
  finger: string;
  hand: "left" | "right";
  /** Presses on this finger's keys, plus keys it should have pressed and did not. */
  attempts: number;
  errors: number;
  errorRate: number;
  /** Time from the previous key going down to this finger's key going down. */
  interKey: Spread;
};

export type SameFingerPair = { finger: string; from: number; to: number; interKey: Spread };
export type RollRow = {
  fromFinger: string;
  toFinger: string;
  from: number;
  to: number;
  /** All the transitions from `from` to `to`, and how many had the second key down before the first came up. */
  n: number;
  rolls: number;
  /** How long the first key was still down after the second went down, over the rolls. */
  overlap: Spread;
};
export type HoldRow = {
  position: number;
  /** Down to up, for the presses meant as taps and for those meant as holds. */
  taps: Spread;
  holds: Spread;
  /** The tapping term the key's profile has, when it is a number. */
  termMs: number | undefined;
  /** Taps held longer than 80% of the term: close to turning into holds. */
  nearTerm: number;
};

export type FingerStats = {
  presses: number;
  errors: number;
  interKey: Spread;
  fingers: FingerRow[];
  sameFinger: SameFingerPair[];
  rolls: RollRow[];
  holds: HoldRow[];
};

type Input = { board: BoardDefinition; layout: Layout; presses: readonly Press[]; aligned: readonly Aligned[]; differences: readonly Difference[] };

const fingerOf = (board: BoardDefinition, position: number): string | undefined => board.fingers[String(position)];
const handOf = (board: BoardDefinition, position: number): "left" | "right" => (board.hands.left.includes(position) ? "left" : "right");

function termOf(layout: Layout, profileId: string): number | undefined {
  const profile = layout.holdTapProfiles.find((p) => p.id === profileId);
  const own = profile?.options[profile.firmware === "qmk" ? "TAPPING_TERM" : "tapping-term-ms"];
  if (typeof own === "number") return own;
  const global = layout.settings.find((s) => s.firmware === "qmk" && s.key === "TAPPING_TERM")?.value;
  return typeof global === "number" ? global : undefined;
}

export function fingerStats(input: Input): FingerStats {
  const { board, layout, presses, aligned, differences } = input;
  const bindings = layout.layers[0]?.bindings ?? [];

  const attempts = new Map<string, number>();
  const errors = new Map<string, number>();
  const bump = (m: Map<string, number>, finger: string | undefined) => {
    if (finger !== undefined) m.set(finger, (m.get(finger) ?? 0) + 1);
  };
  for (const p of presses) bump(attempts, fingerOf(board, p.position));
  for (const a of aligned) if (a.kind === "skipped") bump(attempts, fingerOf(board, a.step.positions[0] as number));

  const faultyPress = new Set<number>();
  for (const d of differences) {
    const finger = d.position !== undefined ? fingerOf(board, d.position) : d.expectedPositions?.[0] !== undefined ? fingerOf(board, d.expectedPositions[0]) : undefined;
    bump(errors, finger);
    if (d.pressIndex !== undefined) faultyPress.add(d.pressIndex);
  }

  const gaps = new Map<string, number[]>();
  const all: number[] = [];
  const sameFinger = new Map<string, { finger: string; from: number; to: number; gaps: number[] }>();
  const rollTable = new Map<string, { fromFinger: string; toFinger: string; from: number; to: number; n: number; overlaps: number[] }>();
  for (let i = 1; i < presses.length; i++) {
    const a = presses[i - 1] as Press;
    const b = presses[i] as Press;
    const dt = b.downAt - a.downAt;
    const fa = fingerOf(board, a.position);
    const fb = fingerOf(board, b.position);
    if (fb === undefined || dt > PAUSE_MS) continue;
    all.push(dt);
    gaps.set(fb, [...(gaps.get(fb) ?? []), dt]);
    if (fa === undefined || a.position === b.position) continue;
    if (fa === fb) {
      const key = `${a.position}>${b.position}`;
      const row = sameFinger.get(key) ?? { finger: fa, from: a.position, to: b.position, gaps: [] };
      row.gaps.push(dt);
      sameFinger.set(key, row);
    } else {
      const key = `${a.position}>${b.position}`;
      const row = rollTable.get(key) ?? { fromFinger: fa, toFinger: fb, from: a.position, to: b.position, n: 0, overlaps: [] };
      row.n++;
      if (b.downAt < a.upAt) row.overlaps.push(a.upAt - b.downAt);
      rollTable.set(key, row);
    }
  }

  const fingers = [...new Set(Object.values(board.fingers))]
    .filter((f) => (attempts.get(f) ?? 0) > 0)
    .map((finger): FingerRow => {
      const n = attempts.get(finger) as number;
      const e = errors.get(finger) ?? 0;
      return { finger, hand: finger.startsWith("left") ? "left" : "right", attempts: n, errors: e, errorRate: n === 0 ? 0 : e / n, interKey: spread(gaps.get(finger) ?? []) };
    });

  const matched = new Map<number, "tap" | "hold">();
  for (const a of aligned) if (a.kind === "match") matched.set(a.press.index, a.step.intent);
  const holdRows = new Map<number, { taps: number[]; holds: number[] }>();
  for (const p of presses) {
    const b = bindings[p.position];
    if (b?.kind !== "holdTap" || holdModsOf(b) === undefined) continue;
    const intent = matched.get(p.index);
    if (intent === undefined) continue;
    const row = holdRows.get(p.position) ?? { taps: [], holds: [] };
    (intent === "tap" ? row.taps : row.holds).push(p.upAt - p.downAt);
    holdRows.set(p.position, row);
  }
  const holds = [...holdRows].map(([position, row]): HoldRow => {
    const b = bindings[position];
    const termMs = b?.kind === "holdTap" ? termOf(layout, b.profileId) : undefined;
    return { position, taps: spread(row.taps), holds: spread(row.holds), termMs, nearTerm: termMs === undefined ? 0 : row.taps.filter((d) => d > 0.8 * termMs).length };
  });

  return {
    presses: presses.length,
    errors: differences.length,
    interKey: spread(all),
    fingers,
    sameFinger: [...sameFinger.values()].filter((r) => r.gaps.length >= MIN_SAMPLES).map((r) => ({ finger: r.finger, from: r.from, to: r.to, interKey: spread(r.gaps) })),
    rolls: [...rollTable.values()]
      .filter((r) => r.n >= MIN_SAMPLES)
      .map((r) => ({ fromFinger: r.fromFinger, toFinger: r.toFinger, from: r.from, to: r.to, n: r.n, rolls: r.overlaps.length, overlap: spread(r.overlaps) })),
    holds,
  };
}

/** Whether a position's binding is a tap on this layout; used by sentences to name keys. */
export const keyCode = (layout: Layout, position: number): string | undefined => tapCodeOf(layout.layers[0]?.bindings[position]);
export { handOf };
