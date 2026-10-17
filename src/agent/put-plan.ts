// "Put my config on this keyboard" (22#putting-bks-config-on-it): a whole layout, every layer, mapped onto a board that has none yet,
// by the cross-board mapping (20). It is rung 19's `map_keys` and `carry` run over all layers at once, against a target that starts
// empty, so there is no key to keep a tap from and no existing behaviour to protect. What has no counterpart is reported, and a layer
// key that would otherwise leave a layer unreachable gets a placement proposal on a free key, never a forced one (D-249). Pure.
import { keyName, keyPlace } from "../boards/key-names.ts";
import { boardCapabilities, lightingRefusal } from "../boards/capabilities.ts";
import type { KeyMapping, UnmatchedWhy } from "../boards/correspondence.ts";
import { keySlots, slotDistance } from "../boards/key-slots.ts";
import { holdKeyCandidates } from "../boards/placement.ts";
import type { Board } from "../boards/load.ts";
import type { ChangeOp } from "../layout/change.ts";
import type { LayerMatch } from "../layout/layer-match.ts";
import { ownTap, tapOnly } from "../layout/rewrap.ts";
import type { Binding, Layer, Layout } from "../layout/schema.ts";
import { BindingTransfer } from "../layout/transfer.ts";
import { evaluate } from "../validation/validate.ts";
import { findLayer, mapLayer, planComboCopy, primaryTargets, transferEnv } from "./copy-plan.ts";
import type { LayerReport, LayoutSnapshot, NotCarried, PlacementCandidate, PlacementProposal } from "./ports.ts";

/** Position matches are the only kind against an empty board; down to a nearer column is still "the same finger, the same row". Anything weaker is not carried. */
export const PUT_MIN_CONFIDENCE = 0.3;
/** A match under this is carried but called a guess, so the person sees which keys to check. */
const SURE = 0.6;

/** `name` is the place ("right thumb, inner"). `replaces` is what the base layer would lose there: the key carried to that place by a nearest-place guess. Absent for a free key. */
export type { LayerReport, NotCarried, PlacementCandidate, PlacementProposal } from "./ports.ts";

export type PutPlan = {
  /** The mapped proposal: layers, behaviours and every key with a counterpart. */
  ops: ChangeOp[];
  /** `ops` plus the first-choice placement of each layer key that had no counterpart; empty when there is none to place. */
  opsWithPlacements: ChangeOp[];
  placements: PlacementProposal[];
  layers: LayerReport[];
  /** Keys that did not come across, with the reason; keys that were empty on the source are left out. */
  notCarried: NotCarried[];
  combos: { copied: string[]; skipped: Array<{ id: string; why: string }> };
  /** What translating settings had to leave out, and what is not carried at all. */
  notes: string[];
};

const WHY: Record<UnmatchedWhy, string> = {
  "no-key-does-this": "no key on the new board does this",
  "no-place-on-target": "the new board has no key in this place",
  "target-keys-taken": "every key it could take fits another key better",
  "has-no-place": "the source board gives this key no hand or finger",
};

const dedupe = (ops: ChangeOp[]): ChangeOp[] => {
  const seen = new Set<string>();
  return ops.filter((o) => {
    const key = o.op === "upsertMacro" ? `m:${o.macro.id}` : o.op === "upsertTapDance" ? `t:${o.tapDance.id}` : o.op === "upsertHoldTapProfile" ? `p:${o.profile.id}` : null;
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Source layer id to target layer id. The target's own first layer is `base`; the others keep their ids unless one would clash with it. */
function layerIds(source: Layout): Map<string, string> {
  const taken = new Set(["base"]);
  const out = new Map<string, string>();
  source.layers.forEach((l, i) => {
    let id = i === 0 ? "base" : l.id;
    for (let n = 2; i > 0 && taken.has(id); n++) id = `${l.id}-${n}`;
    taken.add(id);
    out.set(l.id, id);
  });
  return out;
}

/** The target as it will be once the layer ops run: the base layer is empty and every other layer is transparent, as `addLayer` fills it. */
function scaffold(source: Layout, board: Board, ids: ReadonlyMap<string, string>): Layout {
  const def = board.definition;
  return {
    schemaVersion: 1, boardId: def.id, firmware: def.firmware,
    layers: source.layers.map((l, i): Layer => ({
      id: ids.get(l.id) as string, name: l.name,
      bindings: Array.from({ length: def.keyCount }, (): Binding => (i === 0 ? { kind: "none" } : { kind: "transparent" })),
    })),
    macros: [], tapDances: [], combos: [], holdTapProfiles: [], settings: [], passthrough: [],
  };
}

const structureOps = (source: Layout, ids: ReadonlyMap<string, string>): ChangeOp[] =>
  source.layers.flatMap((l, i): ChangeOp[] => {
    const id = ids.get(l.id) as string;
    const prior = i === 0 ? undefined : (ids.get(source.layers[i - 1]?.id ?? "") as string);
    return [
      // The blank config's one layer is called "Base"; everything else is added after the layer before it.
      ...(i === 0 ? (l.name === "Base" ? [] : [{ op: "renameLayer", layerId: id, name: l.name } as ChangeOp]) : [{ op: "addLayer", layer: { id, name: l.name }, afterLayerId: prior as string } as ChangeOp]),
      ...(l.shortLabel !== undefined || l.color !== undefined ? [{ op: "setLayerStyle", layerId: id, shortLabel: l.shortLabel ?? null, color: l.color ?? null } as ChangeOp] : []),
    ];
  });

const isEmpty = (b: Binding): boolean => b.kind === "none" || b.kind === "transparent";
const holdsLayer = (b: Binding): boolean => (b.kind === "layer" && b.action === "momentary") || (b.kind === "holdTap" && "layerId" in b.hold);
/** The source id for a momentary layer key turned into a hold-tap: no source profile has this id, so the translation falls back to defaults. */
const HOLD_KEY_PROFILE = "layer-hold";
const isLayerKey = (b: Binding): boolean => b.kind === "layer" || (b.kind === "holdTap" && "layerId" in b.hold);

/** `choices`: for a layer key with no counterpart (by its source position), the target key the person chose among the candidates (D-336). */
/** `start`: what the target's new config holds before the put, so a layer key placed on a key the board prefers for holds keeps that key's own tap. */
export function planLayoutPut(from: LayoutSnapshot, target: Board, choices: ReadonlyMap<number, number> = new Map(), start?: Layout): PutPlan {
  const ids = layerIds(from.document);
  const targetDoc = scaffold(from.document, target, ids);
  const to: LayoutSnapshot = { layoutId: "", layoutName: target.definition.name, revisionId: "", document: targetDoc, board: target, onKeyboard: false, archived: false };
  const layers: LayerMatch[] = from.document.layers.map((l, i) => ({
    sourceLayerId: l.id, targetLayerId: ids.get(l.id) as string, score: 1, method: i === 0 ? "role" : "name", signals: { name: 1, role: i === 0 ? 1 : 0, overlap: 0 },
  }));
  const transfer = new BindingTransfer({ ...transferEnv(from, to, layers), keepProfiles: true });
  const slots = keySlots(target.definition, target.geometry).slots;
  const named = (snap: LayoutSnapshot, layer: Layer, position: number) => keyName(snap.board.definition, snap.document, { layerId: layer.id, position }, { geometry: snap.board.geometry, withLayer: false });

  const setOps: ChangeOp[] = [];
  // Who each set op came from, so one the validator refuses can be reported under the source key's name.
  const origin = new Map<string, { layerName: string; source: number; sourceName: string; report: LayerReport }>();
  const notCarried: NotCarried[] = [];
  const layerReports: LayerReport[] = [];
  const placements: PlacementProposal[] = [];
  const baseCarried = new Map<number, { confidence: number; source: number }>();
  let baseMapping: KeyMapping | undefined;

  for (const sLayer of from.document.layers) {
    const tLayer = findLayer(targetDoc, ids.get(sLayer.id) as string);
    const mapping = mapLayer(from, to, sLayer.id, tLayer.id, "auto", layers);
    if (baseMapping === undefined) baseMapping = mapping;
    const carriedTo = primaryTargets(mapping, PUT_MIN_CONFIDENCE, false);
    const report: LayerReport = { source: sLayer.id, target: tLayer.id, carried: 0, guessed: 0, notCarried: 0 };
    const skip = (position: number, why: string) => {
      report.notCarried++;
      notCarried.push({ layerName: sLayer.name, source: position, sourceName: named(from, sLayer, position), why });
    };

    for (const [position, [match]] of [...carriedTo].sort((a, b) => a[0] - b[0])) {
      const binding = sLayer.bindings[position] as Binding;
      if (match === undefined || isEmpty(binding)) continue;
      // A hold-tap keeps its own tap: with no key on the new board yet, the tap comes from the source key itself.
      const seed: Binding = binding.kind === "holdTap" ? tapOnly(binding.tap) : (tLayer.bindings[match.target] as Binding);
      const checkpoint = transfer.checkpoint();
      const result = transfer.bind(binding, seed, match.target);
      if ("skip" in result) {
        transfer.rollback(checkpoint);
        skip(position, result.skip);
        continue;
      }
      setOps.push({ op: "setBinding", at: { layerId: tLayer.id, position: match.target }, binding: result.binding });
      origin.set(`${tLayer.id}:${match.target}`, { layerName: sLayer.name, source: position, sourceName: named(from, sLayer, position), report });
      report.carried++;
      if (match.confidence < SURE) report.guessed++;
      if (sLayer === from.document.layers[0]) baseCarried.set(match.target, { confidence: match.confidence, source: position });
    }

    for (const u of mapping.unmatchedSource) {
      const binding = sLayer.bindings[u.position] as Binding;
      if (isEmpty(binding)) continue;
      skip(u.position, WHY[u.why]);
      if (sLayer === from.document.layers[0] && isLayerKey(binding)) {
        placements.push({ layerId: sLayer.id, layerName: sLayer.name, source: u.position, sourceName: named(from, sLayer, u.position), candidates: [] });
      }
    }
    // Weak matches the floor dropped are not carried either, and say so.
    for (const m of mapping.mapped) {
      if (carriedTo.has(m.source)) continue;
      const binding = sLayer.bindings[m.source] as Binding;
      if (!isEmpty(binding)) skip(m.source, "its only candidate is too weak a match to apply");
    }
    layerReports.push(report);
  }

  // Combos come across with the base layer's mapping, since their positions are base positions.
  const comboPlan = baseMapping === undefined || from.document.combos.length === 0
    ? { ops: [] as ChangeOp[], steps: [] as Array<{ comboId: string; outcome: { copied: string } | { skip: string } }> }
    : planComboCopy(from, to, baseMapping, from.document.combos.map((c) => c.id), layers, PUT_MIN_CONFIDENCE);

  const structure = structureOps(from.document, ids);
  const prerequisites = dedupe([...transfer.prerequisiteOps(), ...comboPlan.ops.filter((o) => o.op !== "upsertCombo")]);
  const comboOps = comboPlan.ops.filter((o) => o.op === "upsertCombo");

  // A key that enters a layer by toggle or "to" is refused when nothing on the new board leads back, which happens when the way back sat on a
  // key with no counterpart. That key is left out and said so; the rest of the layout is not held up by it.
  const blank: Layout = { ...targetDoc, layers: [{ ...(targetDoc.layers[0] as Layer), name: "Base" }] };
  const trapped = new Set(
    evaluate(target.definition, blank, [...structure, ...prerequisites, ...setOps, ...comboOps]).result.errors.filter((e) => e.code === "layer_trap").flatMap((e) => (e.slots ?? []).map((s) => `${s.layerId}:${s.position}`)),
  );
  const carriedOps = setOps.filter((o) => {
    const key = o.op === "setBinding" ? `${o.at.layerId}:${o.at.position}` : "";
    const from_ = origin.get(key);
    if (!trapped.has(key) || from_ === undefined) return true;
    from_.report.carried--;
    from_.report.notCarried++;
    notCarried.push({ layerName: from_.layerName, source: from_.source, sourceName: from_.sourceName, why: "the layer it enters has no key that leads back to the base layer on the new board" });
    return false;
  });
  // Placement: a layer key with no counterpart is offered a key of the same hand, thumbs first, nearest the middle first. A free key
  // comes before one that holds a nearest-place guess, and a key carried with confidence is never offered (D-249: offered, not forced).
  const base = from.document.layers[0] as Layer;
  const sourceSlots = keySlots(from.board.definition, from.board.geometry).slots;
  const placeName = (p: number) => keyPlace(target.definition, p, target.geometry);
  const sourceNameAt = (p: number) => keyName(from.board.definition, from.document, { layerId: base.id, position: p }, { geometry: from.board.geometry, withLayer: false });
  // What a key holds once the carried keys are in: the carried binding, else what the new config started with.
  const ownBinding = (p: number): Binding | null => {
    const carried = carriedOps.findLast((o) => o.op === "setBinding" && o.at.layerId === "base" && o.at.position === p);
    const b = carried?.op === "setBinding" ? carried.binding : start?.layers[0]?.bindings[p];
    return b !== undefined && ownTap(b) !== null ? b : null;
  };
  const taken = new Set<number>();
  const replaced = new Set<number>();
  const placementOps: ChangeOp[] = [];
  for (const placement of placements) {
    const sourceSlot = sourceSlots.get(placement.source);
    if (sourceSlot === undefined) continue;
    const holds = holdKeyCandidates(target.definition, new Set()).map((c) => c.target);
    // A layer held from a key (momentary, or a hold-tap that enters a layer) can sit on a key that keeps its own tap, which is what the
    // board lists for holds (D-234: Space-hold first). Any other layer action takes the key over, so it is only offered keys that hold nothing sure.
    const source = base.bindings[placement.source] as Binding;
    const asHold = holds.length > 0 && holdsLayer(source);
    const rank = (p: number) => {
      const slot = slots.get(p);
      const guess = baseCarried.get(p);
      return [guess === undefined ? 0 : 1, slot?.thumb === true ? 0 : 1, slot?.thumb === true ? slot.thumbRank : slotDistance(sourceSlot, slot)] as const;
    };
    const free = (p: number) => baseCarried.get(p) === undefined || (baseCarried.get(p) as { confidence: number }).confidence < SURE;
    const pool = holds.length > 0 ? holds.filter((p) => asHold || free(p)) : target.definition.hands[sourceSlot.hand].filter(free);
    placement.candidates = pool
      .filter((p) => !taken.has(p))
      .sort((a, b) => {
        if (holds.length > 0) return holds.indexOf(a) - holds.indexOf(b);
        const [ra, rb] = [rank(a), rank(b)];
        return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || a - b;
      })
      .slice(0, 3)
      .map((p): PlacementCandidate => {
        const there = baseCarried.get(p);
        const own = ownBinding(p);
        const name = holds.length > 0 && start !== undefined ? keyName(target.definition, { ...start, layers: [{ ...(start.layers[0] as Layer), id: "base" }] }, { layerId: "base", position: p }, { geometry: target.geometry, withLayer: false }) : placeName(p);
        return { target: p, name, ...(there === undefined || (asHold && own !== null) ? {} : { replaces: sourceNameAt(there.source) }) };
      });
    // The person's pick among the candidates, where they made one; keyloom's first choice otherwise.
    const chosen = choices.get(placement.source);
    const first = (chosen === undefined ? undefined : placement.candidates.find((c) => c.target === chosen)) ?? placement.candidates[0];
    if (first === undefined) continue;
    const own = holds.length > 0 && asHold ? ownBinding(first.target) : null;
    // Onto a hold key the tap is the key's own, so Space stays Space; a plain momentary layer key becomes a hold-tap on it with the board's default timing.
    const binding: Binding = own !== null && source.kind === "layer" ? { kind: "holdTap", tap: ownTap(own) as NonNullable<ReturnType<typeof ownTap>>, hold: { layerId: source.layerId }, profileId: HOLD_KEY_PROFILE } : source;
    const checkpoint = transfer.checkpoint();
    const result = transfer.bind(binding, own !== null ? own : binding.kind === "holdTap" ? tapOnly(binding.tap) : { kind: "none" }, first.target);
    if ("skip" in result) {
      transfer.rollback(checkpoint);
      continue;
    }
    const op: ChangeOp = { op: "setBinding", at: { layerId: "base", position: first.target }, binding: result.binding };
    const trial = [...structure, ...dedupe([...transfer.prerequisiteOps(), ...comboPlan.ops.filter((o) => o.op !== "upsertCombo")]), ...carriedOps.filter((o) => !(o.op === "setBinding" && o.at.layerId === "base" && (replaced.has(o.at.position) || o.at.position === first.target))), ...placementOps, op, ...comboOps];
    if (evaluate(target.definition, blank, trial).result.errors.some((e) => e.code === "layer_trap")) {
      transfer.rollback(checkpoint);
      placement.blocked = "the layer it enters has no key that leads back to the base layer on the new board";
      continue;
    }
    taken.add(first.target);
    if (baseCarried.has(first.target) || own !== null) replaced.add(first.target);
    placementOps.push(op);
  }
  const kept = carriedOps.filter((o) => !(o.op === "setBinding" && o.at.layerId === "base" && replaced.has(o.at.position)));
  // Reachability (D-383): on a board that lists keys to hold a layer from, every carried layer gets a way in, and a layer that can't is
  // left out and said so, never proposed unreachable. The key a layer is held from keeps its own tap.
  const pool = [...(target.definition.holdKeyPreference ?? []), ...(target.definition.holdKeyFallback ?? [])];
  const sourceLayerOf = (targetId: string) => [...ids].find(([, t]) => t === targetId)?.[0];
  const assemble = (sets: ChangeOp[]): ChangeOp[] => [...structure, ...dedupe([...transfer.prerequisiteOps(), ...comboPlan.ops.filter((o) => o.op !== "upsertCombo")]), ...sets, ...comboOps];
  const unreachable = (sets: ChangeOp[]): string[] =>
    [...new Set((() => { const r = evaluate(target.definition, blank, assemble(sets)).result; return [...r.errors, ...r.warnings]; })().filter((i) => i.code === "layer_unreachable" && i.layerId !== undefined).map((i) => i.layerId as string))];
  const reach = (sets: ChangeOp[], used: ReadonlySet<number>): { sets: ChangeOp[]; entries: string[]; stuck: string[] } => {
    if (pool.length === 0) return { sets, entries: [], stuck: [] };
    const free = pool.filter((p) => p < target.definition.keyCount && !used.has(p));
    const entries: string[] = [];
    const out = [...sets];
    for (;;) {
      const [layer] = unreachable(out);
      if (layer === undefined) return { sets: out, entries, stuck: [] };
      let placed = false;
      while (!placed) {
        const p = free.shift();
        if (p === undefined) return { sets: out, entries, stuck: [layer, ...unreachable(out).filter((l) => l !== layer)] };
        const earlier = out.findLast((o) => o.op === "setBinding" && o.at.layerId === "base" && o.at.position === p);
        const own = earlier?.op === "setBinding" ? earlier.binding : start?.layers[0]?.bindings[p];
        const tap = own === undefined ? null : ownTap(own);
        const sourceLayer = sourceLayerOf(layer);
        let binding: Binding;
        if (tap === null) binding = { kind: "layer", action: "momentary", layerId: layer };
        else {
          const checkpoint = transfer.checkpoint();
          const result = transfer.bind({ kind: "holdTap", tap, hold: { layerId: sourceLayer ?? layer }, profileId: HOLD_KEY_PROFILE }, own as Binding, p);
          if ("skip" in result) {
            transfer.rollback(checkpoint);
            continue;
          }
          binding = result.binding;
        }
        const candidate: ChangeOp = { op: "setBinding", at: { layerId: "base", position: p }, binding };
        if (unreachable([...out, candidate]).includes(layer) && tap !== null) continue;
        out.push(candidate);
        entries.push(`${layerNames.get(layer) ?? layer} from ${keyName(target.definition, { ...(start as Layout), layers: [{ ...((start as Layout).layers[0] as Layer), id: "base" }] }, { layerId: "base", position: p }, { geometry: target.geometry, withLayer: false })}`);
        placed = true;
      }
    }
  };
  const layerNames = new Map(from.document.layers.map((l) => [ids.get(l.id) as string, l.name]));
  const placedTargets = new Set(placementOps.flatMap((o) => (o.op === "setBinding" ? [o.at.position] : [])));
  const mainReach = reach(carriedOps, new Set());
  if (mainReach.stuck.length > 0 && start !== undefined) {
    // No key is left to enter these: carry fewer layers instead of an unreachable one.
    const names = mainReach.stuck.map((l) => layerNames.get(l) ?? l);
    const drop = new Set(mainReach.stuck.flatMap((l) => sourceLayerOf(l) ?? []));
    const smaller = planLayoutPut({ ...from, document: { ...from.document, layers: from.document.layers.filter((l) => !drop.has(l.id)) } }, target, choices, start);
    return { ...smaller, notes: [`Left out ${names.join(", ")}: every key a layer can be held from is already used, and a layer with no way in can't be reached`, ...smaller.notes] };
  }
  const ops: ChangeOp[] = assemble(mainReach.sets);
  const placedReach = placementOps.length === 0 ? undefined : reach([...kept, ...placementOps], placedTargets);
  const opsWithPlacements: ChangeOp[] = placedReach === undefined || placedReach.stuck.length > 0 ? [] : assemble(placedReach.sets);

  const notes = [...new Set(transfer.notes)];
  if (mainReach.entries.length > 0) notes.push(`To keep every layer reachable, ${mainReach.entries.join("; ")} (held, keeping the key's own tap)`);
  const coloured = from.document.layers.some((l) => l.lighting !== undefined);
  if (coloured && !boardCapabilities(target.definition).lighting.supported) notes.push(`LED colours were not carried: ${lightingRefusal(target.definition)}`);
  if (from.document.settings.length > 0) notes.push(`${from.document.settings.length} firmware setting${from.document.settings.length === 1 ? "" : "s"} on ${from.layoutName} (timings, features) were not carried; set them for this board once it works`);
  if (from.document.passthrough.length > 0) notes.push("firmware code keyloom does not model (passthrough) was not carried");

  return {
    ops, opsWithPlacements, placements, layers: layerReports, notCarried,
    combos: {
      copied: comboPlan.steps.flatMap((s) => ("copied" in s.outcome ? [s.comboId] : [])),
      skipped: comboPlan.steps.flatMap((s) => ("skip" in s.outcome ? [{ id: s.comboId, why: s.outcome.skip }] : [])),
    },
    notes,
  };
}
