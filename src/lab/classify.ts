// Replay and classification (D-282): what the firmware did with the keys a person pressed, set against what the passage asked for.
// A difference comes from one of two places. What the hands did (a different key, a missed key, a double press) is the same
// whatever the firmware settings are. What the firmware made of the right keys (a hold where a tap was meant, or the reverse) is what
// a setting can change, and is the part the counterfactuals replay.
import type { EmulatorReport, KeyboardReport } from "../firmware/emulate/types.ts";
import type { Binding, Layout, Mod } from "../layout/schema.ts";
import type { Aligned } from "./align.ts";
import { holdModsOf, tapCodeOf } from "./intent.ts";
import type { Press } from "./presses.ts";

export type DifferenceKind = "misfire-hold" | "misfire-tap" | "typo" | "missed" | "double";

export type Difference = {
  kind: DifferenceKind;
  /** The press involved; absent for a key that was never pressed. */
  pressIndex?: number;
  /** The key the hand was on. */
  position?: number;
  /** The keys that would have been right. */
  expectedPositions?: number[];
  /** Milliseconds into the recording. */
  at: number;
  /** For a missed key: whether the person never pressed it or the keyboard swallowed it. */
  cause?: "you" | "keyboard";
  /** For a missed key the keyboard swallowed: the combo that took it, when the keys of one were pressed together. */
  comboId?: string;
  /** For a misfire: the hold-tap profile whose setting decided it. */
  profileId?: string;
  /** For a misfire: the facts an example is made of. */
  facts?: MisfireFacts;
};

export type MisfireFacts = {
  /** How long the key was down. */
  heldMs: number;
  /** How long it was still down after the next key went down; 0 when it came up first. */
  overlapMs: number;
  previousPosition?: number;
  nextPosition?: number;
  /** The gap since the last key came up. */
  priorIdleMs: number;
};

/** Keys of one combo pressed within this of each other may have been taken for it; QMK's own COMBO_TERM is 50 ms and a layout may raise it. */
const COMBO_WINDOW_MS = 200;

/** A key pressed again this soon after it came up is a double press, not a repeated letter. */
export const DOUBLE_PRESS_MS = 120;
/** How long after a key came up its tap may still arrive: QMK and ZMK send a tap when the key is released. */
const RELEASE_GRACE_MS = 100;

export function keyboardReports(reports: readonly EmulatorReport[]): KeyboardReport[] {
  return reports.filter((r): r is KeyboardReport => r.kind === "keyboard");
}

/** Whether `code` went down (it was not down in the report before) in [from, to]. */
export function tapFired(reports: readonly KeyboardReport[], code: string, from: number, to: number): boolean {
  let before = new Set<string>();
  for (const r of reports) {
    if (r.at >= from && r.at <= to && r.keys.includes(code) && !before.has(code)) return true;
    before = new Set(r.keys);
  }
  return false;
}

/** Whether all of `mods` became active (they were not all active in the report before) in [from, to]. */
export function holdFired(reports: readonly KeyboardReport[], mods: readonly Mod[], from: number, to: number): boolean {
  let before: readonly string[] = [];
  for (const r of reports) {
    const now = mods.every((m) => r.mods.includes(m));
    if (r.at >= from && r.at <= to && now && !mods.every((m) => before.includes(m))) return true;
    before = r.mods;
  }
  return false;
}

/** Typos, missed keys and double presses: what the hands did. */
export function physicalDifferences(aligned: readonly Aligned[], presses: readonly Press[]): Difference[] {
  const out: Difference[] = [];
  let last: Press | undefined;
  for (const a of aligned) {
    if (a.kind === "wrong") {
      out.push({ kind: "typo", pressIndex: a.press.index, position: a.press.position, expectedPositions: a.step.positions, at: a.press.downAt });
    } else if (a.kind === "extra") {
      // Either of two identical presses can be the extra one when they are lined up, so both neighbours count.
      const before = presses[a.press.index - 1];
      const after = presses[a.press.index + 1];
      const again =
        (before !== undefined && before.position === a.press.position && a.press.downAt - before.upAt < DOUBLE_PRESS_MS) ||
        (after !== undefined && after.position === a.press.position && after.downAt - a.press.upAt < DOUBLE_PRESS_MS);
      out.push({ kind: again ? "double" : "typo", pressIndex: a.press.index, position: a.press.position, at: a.press.downAt });
    } else if (a.kind === "skipped") {
      out.push({ kind: "missed", expectedPositions: a.step.positions, at: last?.upAt ?? 0, cause: "you" });
    }
    if (a.kind !== "skipped") last = a.press;
  }
  return out;
}

const profileOf = (b: Binding | undefined): string | undefined => (b?.kind === "holdTap" ? b.profileId : undefined);

/** The facts about a press that make a misfire an example. */
function factsOf(press: Press, presses: readonly Press[]): MisfireFacts {
  const previous = presses[press.index - 1];
  const next = presses[press.index + 1];
  const overlapMs = next !== undefined && next.downAt < press.upAt ? press.upAt - next.downAt : 0;
  const priorUp = presses.slice(0, press.index).reduce((latest, p) => Math.max(latest, p.upAt), Number.NEGATIVE_INFINITY);
  return {
    heldMs: press.upAt - press.downAt,
    overlapMs,
    ...(previous ? { previousPosition: previous.position } : {}),
    ...(next ? { nextPosition: next.position } : {}),
    priorIdleMs: Number.isFinite(priorUp) ? Math.max(0, press.downAt - priorUp) : press.downAt,
  };
}

/**
 * What the firmware did with each press the hands got right. A hold-tap key that was meant as a tap and did not type its letter is a
 * hold where a tap was meant; one meant as a hold that did not put its modifier on is a tap where a hold was meant.
 */
export function outcomeDifferences(layout: Layout, aligned: readonly Aligned[], presses: readonly Press[], reports: readonly EmulatorReport[]): Difference[] {
  const keyboard = keyboardReports(reports);
  const bindings = layout.layers[0]?.bindings ?? [];
  const nextSame = (press: Press) => presses.find((p) => p.index > press.index && p.position === press.position);
  const out: Difference[] = [];
  // A combo takes all its keys, so it is one difference at its first key, not one per key.
  const taken = new Set<number>();
  const comboOf = (press: Press) =>
    layout.combos.find((c) => c.positions.includes(press.position) && c.positions.every((p) => presses.some((q) => q.position === p && Math.abs(q.downAt - press.downAt) <= COMBO_WINDOW_MS)));
  const swallowed = (press: Press, base: { pressIndex: number; position: number; at: number }): Difference[] => {
    const combo = comboOf(press);
    if (!combo) return [{ ...base, kind: "missed", cause: "keyboard" }];
    const group = presses.filter((q) => combo.positions.includes(q.position) && Math.abs(q.downAt - press.downAt) <= COMBO_WINDOW_MS);
    for (const q of group) taken.add(q.index);
    const first = group.reduce((a, b) => (b.downAt < a.downAt ? b : a));
    return [{ kind: "missed", cause: "keyboard", comboId: combo.id, pressIndex: first.index, position: first.position, at: first.downAt }];
  };

  for (const a of aligned) {
    if (a.kind !== "match") continue;
    const { press, step } = a;
    if (taken.has(press.index)) continue;
    const binding = bindings[press.position];
    const code = tapCodeOf(binding);
    if (code === undefined) continue;
    const next = nextSame(press);
    // Up to the key's next press, whose own output must not be taken for this one's.
    const to = Math.min(press.upAt + RELEASE_GRACE_MS, next ? next.downAt - 1 : Number.POSITIVE_INFINITY);
    const typed = tapFired(keyboard, code, press.downAt, to);
    const mods = holdModsOf(binding);
    const base = { pressIndex: press.index, position: press.position, at: press.downAt };

    if (binding?.kind === "holdTap") {
      const profileId = profileOf(binding) as string;
      if (step.intent === "tap" && !typed) {
        // With a modifier hold we can see whether it fired; a layer hold has no modifier to see, and a tap that typed nothing means it held.
        const held = mods === undefined || holdFired(keyboard, mods, press.downAt, to);
        if (held) out.push({ ...base, kind: "misfire-hold", profileId, facts: factsOf(press, presses) });
        else out.push(...swallowed(press, base));
      } else if (step.intent === "hold" && mods !== undefined && !holdFired(keyboard, mods, press.downAt, to)) {
        out.push({ ...base, kind: "misfire-tap", profileId, facts: factsOf(press, presses) });
      }
    } else if (step.intent === "tap" && !typed) {
      out.push(...swallowed(press, base));
    }
  }
  return out;
}

export const isMisfire = (d: Difference): d is Difference & { kind: "misfire-hold" | "misfire-tap"; pressIndex: number } => d.kind === "misfire-hold" || d.kind === "misfire-tap";
