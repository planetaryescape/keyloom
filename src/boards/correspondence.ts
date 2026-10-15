// Which key of one layer is "the same key" on another board's layer (20#algorithm). Two ways to
// answer, and one that tries them in turn:
//   function: the target key that does the same thing (types A, holds Command, goes to the Navigation layer)
//   position: the target key in the same place for a hand (same finger, same row from the home row, same column from the finger's home key; thumbs by rank)
//   auto:     function first, then position for what is left, on target keys nothing else claimed
// Each match carries a reason in words and a confidence from 0 to 1, and a key with no counterpart is
// listed as unmatched instead of being forced onto the nearest key. Pure and deterministic: ties are
// broken by position number, never by the order of any list in a document or a board file.
import { bindingFunctions } from "../layout/functions.ts";
import { type LayerMatch, matchLayers } from "../layout/layer-match.ts";
import type { Binding, Layout } from "../layout/schema.ts";
import { type KeySlot, describeSlot, keySlots, slotDistance } from "./key-slots.ts";
import type { BoardDefinition, Geometry } from "./schema.ts";

export type Strategy = "function" | "position" | "auto";

export type KeyMatch = {
  target: number;
  method: "function" | "position";
  /** In words a person uses, such as "types the same key, in the same place for the left ring finger". */
  reason: string;
  confidence: number;
  /** A further key that also does this thing, offered after the best one; copying a colour may use it, copying a behaviour should not. */
  extra: boolean;
};

export type MappedKey = { source: number; matches: KeyMatch[] };

export type UnmatchedWhy =
  | "no-key-does-this" // function: the target layer has nothing with this function
  | "no-place-on-target" // position: the target has no key for that finger, row or column
  | "target-keys-taken" // position: every candidate was a better match for another key
  | "has-no-place"; // the board file gives this key no hand or finger

export type Side = { layout: Layout; board: { definition: BoardDefinition; geometry: Geometry }; layerId: string };

export type KeyMapping = {
  strategy: Strategy;
  sourceLayerId: string;
  targetLayerId: string;
  mapped: MappedKey[];
  unmatchedSource: { position: number; why: UnmatchedWhy }[];
  /** Target keys no source key maps to. */
  unmatchedTarget: number[];
};

// Same place is weaker evidence than same function: two keys under one finger can do unrelated things, so a position match tops out below a function match.
const POSITION_CONFIDENCE = { exact: 0.7, thumbSameCount: 0.5, thumbDifferentCount: 0.4 };

/** The layer ids of the source rewritten as the target's, so "go to Navigation" on one board equals it on the other. */
function layerIdMap(matches: readonly LayerMatch[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of matches) if (m.targetLayerId !== null) out.set(m.sourceLayerId, m.targetLayerId);
  return out;
}

/** A binding's functions, with ids that mean different things in each layout replaced by what they stand for. */
function signature(layout: Layout, b: Binding, layers: ReadonlyMap<string, string> | null): string[] {
  return bindingFunctions(b, layout.tapDances).map((f) => {
    const layer = /^layer:([a-zA-Z]+):(.+)$/.exec(f);
    if (layer) {
      const [, action, id] = layer as unknown as [string, string, string];
      // The target keeps its own ids; a source id without a counterpart is marked so it can never equal one.
      return layers === null ? f : `layer:${action}:${layers.get(id) ?? `?${id}`}`;
    }
    const macro = /^macro:(.+)$/.exec(f);
    if (macro) {
      const m = layout.macros.find((x) => x.id === macro[1]);
      return m === undefined ? f : `macro:${JSON.stringify(m.steps)}`;
    }
    return f;
  });
}

type Pair = { s: number; t: number; cost: number };

/** One-to-one pairs, cheapest first, ties by source then target position. */
function claim(pairs: Pair[], takenS: Set<number>, takenT: Set<number>): Pair[] {
  const out: Pair[] = [];
  for (const p of [...pairs].sort((a, b) => a.cost - b.cost || a.s - b.s || a.t - b.t)) {
    if (takenS.has(p.s) || takenT.has(p.t)) continue;
    takenS.add(p.s);
    takenT.add(p.t);
    out.push(p);
  }
  return out;
}

export function mapKeys(source: Side, target: Side, strategy: Strategy = "auto", layerMatches: readonly LayerMatch[] = matchLayers(source.layout, target.layout)): KeyMapping {
  const sLayer = source.layout.layers.find((l) => l.id === source.layerId);
  const tLayer = target.layout.layers.find((l) => l.id === target.layerId);
  if (sLayer === undefined) throw new Error(`no layer "${source.layerId}" in the source layout`);
  if (tLayer === undefined) throw new Error(`no layer "${target.layerId}" in the target layout`);
  const layers = layerIdMap(layerMatches);
  const sSlots = keySlots(source.board.definition, source.board.geometry);
  const tSlots = keySlots(target.board.definition, target.board.geometry);
  const sPositions = sLayer.bindings.map((_, i) => i).filter((i) => i < source.board.definition.keyCount);
  const tPositions = tLayer.bindings.map((_, i) => i).filter((i) => i < target.board.definition.keyCount);

  const takenS = new Set<number>();
  const takenT = new Set<number>();
  const matches = new Map<number, KeyMatch[]>();
  const add = (s: number, m: KeyMatch) => matches.set(s, [...(matches.get(s) ?? []), m]);
  const unmatchedWhy = new Map<number, UnmatchedWhy>();

  if (strategy === "function" || strategy === "auto") {
    const sSig = new Map(sPositions.map((p) => [p, signature(source.layout, sLayer.bindings[p] as Binding, layers)]));
    const tSig = new Map(tPositions.map((p) => [p, signature(target.layout, tLayer.bindings[p] as Binding, null)]));
    const doesSomething = (sig: string[]) => sig.length > 0;
    const spare: Array<{ t: number; from: number[] }> = [];

    for (const level of ["exact", "primary"] as const) {
      const key = (sig: string[]) => (level === "exact" ? JSON.stringify(sig) : (sig[0] ?? ""));
      const groups = new Map<string, { s: number[]; t: number[] }>();
      for (const p of sPositions) {
        const sig = sSig.get(p) as string[];
        if (takenS.has(p) || !doesSomething(sig)) continue;
        const g = groups.get(key(sig)) ?? { s: [], t: [] };
        g.s.push(p);
        groups.set(key(sig), g);
      }
      for (const p of tPositions) {
        const sig = tSig.get(p) as string[];
        if (!doesSomething(sig)) continue;
        // A target key an earlier level used still belongs to its group at the primary level only if nothing took it.
        if (takenT.has(p) && level === "primary") continue;
        const g = groups.get(key(sig));
        if (g === undefined) continue;
        g.t.push(p);
      }
      for (const g of groups.values()) {
        if (g.s.length === 0 || g.t.length === 0) continue;
        const free = g.t.filter((t) => !takenT.has(t));
        const pairs: Pair[] = g.s.flatMap((s) => free.map((t) => ({ s, t, cost: slotDistance(sSlots.slots.get(s), tSlots.slots.get(t)) })));
        const contested = g.s.length > 1 && free.length > 1;
        const made = claim(pairs, takenS, takenT);
        for (const { s, t } of made) {
          const here = sSlots.slots.get(s);
          const there = tSlots.slots.get(t);
          const sameFinger = here !== undefined && there !== undefined && here.hand === there.hand && here.finger === there.finger;
          const base = level === "exact" ? (sameFinger ? 0.95 : 0.85) : sameFinger ? 0.8 : 0.7;
          const what = level === "exact" ? "does the same thing" : "types the same key (the hold differs)";
          const where = sameFinger ? `, and sits under the same ${there?.hand} ${there?.finger === "thumb" ? "thumb" : `${there?.finger} finger`}` : ", but not under the same finger";
          const pairedByPlace = contested ? "; several keys do this, so it was paired by nearest position" : "";
          add(s, { target: t, method: "function", reason: `${what}${where}${pairedByPlace}`, confidence: round2(contested ? base * 0.9 : base), extra: false });
        }
        // A target with more keys of this function than the source has: the spare ones are offered, not assigned.
        if (level === "exact") for (const t of free) if (!takenT.has(t)) spare.push({ t, from: made.map((m) => m.s) });
      }
    }
    // Only a spare key nothing else claimed at either level is offered.
    for (const { t, from } of spare) {
      if (takenT.has(t)) continue;
      const near = [...from].sort((a, b) => slotDistance(sSlots.slots.get(a), tSlots.slots.get(t)) - slotDistance(sSlots.slots.get(b), tSlots.slots.get(t)) || a - b)[0];
      if (near !== undefined) add(near, { target: t, method: "function", reason: "another key on the target that does the same thing", confidence: 0.5, extra: true });
    }
    for (const p of sPositions) if (!takenS.has(p)) unmatchedWhy.set(p, "no-key-does-this");
  }

  if (strategy === "position" || strategy === "auto") {
    const freeS = sPositions.filter((p) => !takenS.has(p));
    const freeT = tPositions.filter((p) => !takenT.has(p));
    const sameThumbCount = (hand: string) =>
      [...sSlots.slots.values()].filter((s) => s.thumb && s.hand === hand).length === [...tSlots.slots.values()].filter((s) => s.thumb && s.hand === hand).length;
    const pairs: Array<Pair & { slotS: KeySlot; slotT: KeySlot }> = [];
    for (const s of freeS) {
      const a = sSlots.slots.get(s);
      if (a === undefined) {
        unmatchedWhy.set(s, "has-no-place");
        continue;
      }
      for (const t of freeT) {
        const b = tSlots.slots.get(t);
        if (b === undefined || a.hand !== b.hand) continue;
        if (a.thumb && b.thumb) {
          if (a.thumbRank === b.thumbRank) pairs.push({ s, t, cost: 0, slotS: a, slotT: b });
        } else if (!a.thumb && !b.thumb && a.finger === b.finger && a.rowOffset === b.rowOffset) {
          pairs.push({ s, t, cost: Math.abs(a.colOffset - b.colOffset), slotS: a, slotT: b });
        }
      }
    }
    const bySource = new Map(pairs.map((p) => [`${p.s}:${p.t}`, p]));
    for (const { s, t, cost } of claim(pairs, takenS, takenT)) {
      const { slotS, slotT } = bySource.get(`${s}:${t}`) as (typeof pairs)[number];
      let confidence: number;
      let reason: string;
      if (slotS.thumb) {
        confidence = sameThumbCount(slotS.hand) ? POSITION_CONFIDENCE.thumbSameCount : POSITION_CONFIDENCE.thumbDifferentCount;
        reason = `the ${ordinal(slotS.thumbRank + 1)} thumb key from the middle on the ${slotS.hand} hand; thumb clusters differ between boards, so this is a guess`;
      } else if (cost === 0) {
        confidence = POSITION_CONFIDENCE.exact;
        reason = `same place: ${describeSlot(slotT)}`;
      } else {
        confidence = Math.max(0.3, round2(0.5 - 0.1 * (cost - 1)));
        reason = `${describeSlot(slotT)}; the boards have different numbers of columns for this finger, so this is the nearest one`;
      }
      add(s, { target: t, method: "position", reason, confidence, extra: false });
      unmatchedWhy.delete(s);
    }
    for (const p of sPositions) {
      if (takenS.has(p) || unmatchedWhy.get(p) === "has-no-place") continue;
      const a = sSlots.slots.get(p);
      const anyCandidate = a !== undefined && pairs.some((x) => x.s === p);
      unmatchedWhy.set(p, anyCandidate ? "target-keys-taken" : "no-place-on-target");
    }
  }

  const mapped = [...matches]
    .map(([source, ms]) => ({ source, matches: ms.sort((a, b) => Number(a.extra) - Number(b.extra) || b.confidence - a.confidence || a.target - b.target) }))
    .sort((a, b) => a.source - b.source);
  const everTargeted = new Set(mapped.flatMap((m) => m.matches.map((x) => x.target)));
  return {
    strategy,
    sourceLayerId: sLayer.id,
    targetLayerId: tLayer.id,
    mapped,
    unmatchedSource: sPositions.filter((p) => !matches.has(p)).map((position) => ({ position, why: unmatchedWhy.get(position) ?? "no-key-does-this" })),
    unmatchedTarget: tPositions.filter((p) => !everTargeted.has(p)),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ordinal = (n: number) => ["first", "second", "third", "fourth", "fifth", "sixth"][n - 1] ?? `${n}th`;
