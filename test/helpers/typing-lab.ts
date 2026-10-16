// Stand-ins and builders for the typing lab's tests (D-282). `modelReplay` is a small, deterministic model of a tap-hold engine that
// reads a layout's profile options like the generators do, so classification and the counterfactual search can be tested in
// milliseconds. It is a model, not the firmware: the real QMK and ZMK cores are exercised by the gated Docker tests.
import type { Layout, Mod } from "../../src/layout/schema.ts";
import type { BoardDefinition } from "../../src/boards/schema.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import type { EmulatorEvent, EmulatorReport, KeyboardReport } from "../../src/firmware/emulate/types.ts";
import { typedText } from "../../src/firmware/emulate/text.ts";
import type { Replay } from "../../src/lab/analyse.ts";
import { BUILTIN_OPTIONS } from "../../src/firmware/zmk/builtins.ts";
import { FIXTURE_DIR, moonlander } from "./board.ts";

/** BK's Moonlander layout as imported from Oryx, with its board. */
export async function bkMoonlander(): Promise<{ board: BoardDefinition; layout: Layout }> {
  const b = await moonlander();
  return { board: b.definition, layout: (await importOryxSource(FIXTURE_DIR, b.definition)).layout };
}

/** Base-layer positions of the letters on a layout, keyed by letter (the first position when several type it). */
export function letterPositions(layout: Layout): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [position, b] of (layout.layers[0]?.bindings ?? []).entries()) {
    // A key with mods on it (BK's ^B) types a shortcut, not the letter.
    const code = b.kind === "key" && b.mods === undefined ? b.code : b.kind === "holdTap" && b.tap.mods === undefined ? b.tap.code : undefined;
    if (code !== undefined && /^[A-Z]$/.test(code) && out[code.toLowerCase()] === undefined) out[code.toLowerCase()] = position;
  }
  return out;
}

export type Stroke = { position: number; down: number; up: number };

/** Strokes to the events a trace holds, in time order. */
export function eventsOf(strokes: readonly Stroke[]): EmulatorEvent[] {
  return strokes
    .flatMap((s) => [{ at: s.down, position: s.position, action: "press" as const }, { at: s.up, position: s.position, action: "release" as const }])
    .sort((a, b) => a.at - b.at || (a.action === "release" ? -1 : 1) - (b.action === "release" ? -1 : 1));
}

/** A person typing `text` evenly: one key every `pace` ms, each held `hold` ms. */
export function typeText(text: string, positions: Record<string, number>, opts: { pace?: number; hold?: number; start?: number } = {}): Stroke[] {
  const { pace = 140, hold = 90, start = 0 } = opts;
  return [...text].flatMap((ch, i) => (positions[ch] === undefined ? [] : [{ position: positions[ch] as number, down: start + i * pace, up: start + i * pace + hold }]));
}

type Resolved = { term: number; permissive: boolean; holdOnOther: boolean; chordal: boolean; quickTap: number; idle: number; triggers: readonly number[] | undefined };

function resolve(layout: Layout, profileId: string): Resolved {
  const profile = layout.holdTapProfiles.find((p) => p.id === profileId);
  const options = { ...(profile?.firmware === "zmk" ? (BUILTIN_OPTIONS[profileId] ?? {}) : {}), ...(profile?.options ?? {}) };
  const global = (k: string) => layout.settings.find((s) => s.firmware === "qmk" && s.key === k)?.value;
  const zmk = profile?.firmware === "zmk" || layout.firmware === "zmk";
  const flavor = String(options.flavor ?? "hold-preferred");
  return {
    term: Number((zmk ? options["tapping-term-ms"] : (options.TAPPING_TERM ?? global("TAPPING_TERM"))) ?? 200),
    permissive: zmk ? flavor === "balanced" : (options.PERMISSIVE_HOLD ?? global("PERMISSIVE_HOLD")) === true,
    holdOnOther: zmk ? flavor === "hold-preferred" : (options.HOLD_ON_OTHER_KEY_PRESS ?? global("HOLD_ON_OTHER_KEY_PRESS")) === true,
    chordal: !zmk && global("CHORDAL_HOLD") === true,
    quickTap: Number((zmk ? options["quick-tap-ms"] : options.QUICK_TAP_TERM) ?? -1),
    idle: Number((zmk ? options["require-prior-idle-ms"] : global("FLOW_TAP_TERM")) ?? -1),
    triggers: Array.isArray(options["hold-trigger-key-positions"]) ? (options["hold-trigger-key-positions"] as number[]) : undefined,
  };
}

/**
 * The model: for each hold-tap press, find the key pressed while it was down and decide hold or tap from the profile's options. A hold
 * puts the modifier on until the key comes up. Good enough to make a roll longer than the term a hold, and a raised term fix it.
 */
export function modelReplay(board: BoardDefinition): Replay {
  const left = new Set(board.hands.left);
  return async (layout, events) => {
    const presses: Array<{ position: number; down: number; up: number }> = [];
    const open = new Map<number, (typeof presses)[number]>();
    for (const e of events) {
      if (e.action === "press") {
        const p = { position: e.position, down: e.at, up: events.at(-1)?.at ?? e.at };
        presses.push(p);
        open.set(e.position, p);
      } else if (open.has(e.position)) {
        (open.get(e.position) as { up: number }).up = e.at;
        open.delete(e.position);
      }
    }
    const bindings = layout.layers[0]?.bindings ?? [];
    type Out = { at: number; kind: "keyDown" | "keyUp" | "modDown" | "modUp"; code?: string; mods?: Mod[]; order: number };
    const out: Out[] = [];
    let order = 0;
    const emit = (o: Omit<Out, "order">) => out.push({ ...o, order: order++ });
    const lastUp = new Map<number, number>();
    let previousTouch = Number.NEGATIVE_INFINITY;
    // A key pressed while a hold-tap key is undecided is held back until it decides, as the firmware does.
    const heldBack = new Map<(typeof presses)[number], number>();

    // Combos: every key of one went down within the combo term of the first, so the keys are the combo's and its output replaces them.
    const comboTerm = Number(layout.settings.find((x) => x.firmware === "qmk" && x.key === "COMBO_TERM")?.value ?? 50);
    const consumed = new Set<(typeof presses)[number]>();
    for (const combo of layout.combos) {
      for (const first of presses.filter((q) => q.position === combo.positions[0] && !consumed.has(q))) {
        const group = combo.positions.map((position) => presses.find((q) => q.position === position && !consumed.has(q) && Math.abs(q.down - first.down) <= comboTerm));
        if (group.some((q) => q === undefined)) continue;
        const members = group as Array<(typeof presses)[number]>;
        for (const q of members) consumed.add(q);
        const from = Math.max(...members.map((q) => q.down));
        const to = Math.min(...members.map((q) => q.up));
        if (combo.output.kind === "modifier") {
          emit({ at: from, kind: "modDown", mods: combo.output.mods });
          emit({ at: Math.max(from, to), kind: "modUp", mods: combo.output.mods });
        }
      }
    }

    for (const [i, p] of presses.entries()) {
      if (consumed.has(p)) continue;
      const b = bindings[p.position];
      if (b?.kind !== "holdTap" || !("mods" in b.hold)) {
        if (b?.kind === "key") {
          const from = heldBack.get(p) ?? p.down;
          emit({ at: from, kind: "keyDown", code: b.code });
          emit({ at: Math.max(p.up, from), kind: "keyUp", code: b.code });
        } else if (b?.kind === "holdTap") {
          // A layer-tap let go inside its term types its tap; the model has no layers, so a held one types nothing.
          const r = resolve(layout, b.profileId);
          if (p.up - p.down < r.term) {
            emit({ at: p.up, kind: "keyDown", code: b.tap.code });
            emit({ at: p.up + 1, kind: "keyUp", code: b.tap.code });
          }
        }
        previousTouch = Math.max(previousTouch, p.up);
        continue;
      }
      const r = resolve(layout, b.profileId);
      const interrupt = presses.slice(i + 1).find((q) => q.down > p.down && q.down < Math.min(p.up, p.down + r.term));
      const quick = (lastUp.get(p.position) ?? -1e9) + r.quickTap > p.down && r.quickTap >= 0;
      const idle = r.idle >= 0 && p.down - previousTouch < r.idle;
      let hold: number | undefined;
      let tapAt = p.up;
      if (quick || idle) {
        tapAt = p.down;
      } else if (!interrupt) {
        if (p.up - p.down >= r.term) hold = p.down + r.term;
      } else {
        const sameHand = left.has(interrupt.position) === left.has(p.position);
        const chordalTap = (r.chordal && sameHand) || (r.triggers !== undefined && !r.triggers.includes(interrupt.position));
        if (chordalTap) tapAt = interrupt.down;
        else if (r.holdOnOther) hold = interrupt.down;
        else if (r.permissive && interrupt.up <= Math.min(p.up, p.down + r.term)) hold = interrupt.up;
        else if (p.up - p.down >= r.term) hold = p.down + r.term;
        else tapAt = interrupt.down;
      }
      const decided = hold ?? tapAt;
      for (const q of presses.slice(i + 1)) if (q.down > p.down && q.down < decided) heldBack.set(q, Math.max(heldBack.get(q) ?? 0, decided));
      if (hold !== undefined) {
        const mods = b.hold.mods;
        emit({ at: hold, kind: "modDown", mods });
        emit({ at: p.up, kind: "modUp", mods });
      } else {
        emit({ at: tapAt, kind: "keyDown", code: b.tap.code });
        emit({ at: tapAt + 1, kind: "keyUp", code: b.tap.code });
      }
      lastUp.set(p.position, p.up);
      previousTouch = Math.max(previousTouch, p.up);
    }

    out.sort((a, b) => a.at - b.at || a.order - b.order);
    const reports: EmulatorReport[] = [];
    const mods = new Map<Mod, number>();
    const keys = new Set<string>();
    const snapshot = (at: number) => {
      const next: KeyboardReport = { at, kind: "keyboard", mods: [...mods.keys()], keys: [...keys] };
      const last = reports.at(-1) as KeyboardReport | undefined;
      if (!last || last.mods.join() !== next.mods.join() || last.keys.join() !== next.keys.join()) reports.push(next);
    };
    for (const o of out) {
      for (const m of o.mods ?? []) {
        if (o.kind === "modDown") mods.set(m, (mods.get(m) ?? 0) + 1);
        else if (o.kind === "modUp") {
          const n = (mods.get(m) ?? 1) - 1;
          if (n <= 0) mods.delete(m);
          else mods.set(m, n);
        }
      }
      if (o.kind === "keyDown") keys.add(o.code as string);
      if (o.kind === "keyUp") keys.delete(o.code as string);
      snapshot(o.at);
    }
    return { firmware: layout.firmware === "zmk" ? "zmk" : "qmk", reports, text: typedText(reports), warnings: [] };
  };
}

/** A small seeded generator, so a synthetic person types the same way every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A person typing a passage evenly, as strokes in whole milliseconds: taps about 90 ms long every 140 ms or so, and for a "hold" step the
 * mod-tap key down for 420 ms with its partner pressed and let go inside it. The jitter is seeded.
 */
export function syntheticTyping(steps: ReadonlyArray<{ positions: number[]; intent: "tap" | "hold" }>, seed = 1): Stroke[] {
  const random = seeded(seed);
  const jitter = (ms: number) => Math.round(ms * (0.85 + 0.3 * random()));
  const strokes: Stroke[] = [];
  let t = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as (typeof steps)[number];
    const position = step.positions[0] as number;
    if (step.intent === "hold") {
      const partner = steps[++i] as (typeof steps)[number];
      const down = t;
      strokes.push({ position, down, up: down + 420 });
      strokes.push({ position: partner.positions[0] as number, down: down + 250, up: down + 250 + jitter(70) });
      t += 700;
    } else {
      const down = t;
      strokes.push({ position, down, up: down + jitter(90) });
      t += jitter(140);
    }
  }
  return strokes;
}
