// "Put my config on this keyboard" (22#putting-bks-config-on-it): a whole layout, every layer, mapped onto a board that has none yet,
// by the cross-board mapping (20). It is rung 19's `map_keys` and `carry` run over all layers at once, against a target that starts
// empty, so there is no key to keep a tap from and no existing behaviour to protect. What has no counterpart is reported, and a layer
// key that would otherwise leave a layer unreachable gets a placement proposal on a free key, never a forced one (D-249). Pure.
import { keyName, keyPlace } from "../boards/key-names.ts";
import { boardCapabilities, lightingRefusal } from "../boards/capabilities.ts";
import type { KeyMapping, UnmatchedWhy } from "../boards/correspondence.ts";
import { keySlots, slotDistance } from "../boards/key-slots.ts";
import type { Board } from "../boards/load.ts";
import type { ChangeOp } from "../layout/change.ts";
import type { LayerMatch } from "../layout/layer-match.ts";
import { tapOnly } from "../layout/rewrap.ts";
import type { Binding, Layer, Layout } from "../layout/schema.ts";
import { BindingTransfer } from "../layout/transfer.ts";
import { evaluate } from "../validation/validate.ts";
import { findLayer, mapLayer, planComboCopy, primaryTargets, transferEnv } from "./copy-plan.ts";
import type { LayoutSnapshot } from "./ports.ts";

/** Position matches are the only kind against an empty board; down to a nearer column is still "the same finger, the same row". Anything weaker is not carried. */
export const PUT_MIN_CONFIDENCE = 0.3;
/** A match under this is carried but called a guess, so the person sees which keys to check. */
const SURE = 0.6;

/** `name` is the place ("right thumb, inner"). `replaces` is what the base layer would lose there: the key carried to that place by a nearest-place guess. Absent for a free key. */
export type PlacementCandidate = { target: number; name: string; replaces?: string };
export type PlacementProposal = {
  /** Set when no candidate can take the key: the validator would refuse it (a layer it enters has no way back on the new board). */
  blocked?: string;
  /** The key on the source layout and the layer it is on. */
  layerId: string;
  layerName: string;
  source: number;
  sourceName: string;
  /** Free keys on the same hand that could take it, best first. */
  candidates: PlacementCandidate[];
};

export type NotCarried = { layerName: string; source: number; sourceName: string; why: string };

export type LayerReport = { source: string; target: string; carried: number; guessed: number; notCarried: number };

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
const isLayerKey = (b: Binding): boolean => b.kind === "layer" || (b.kind === "holdTap" && "layerId" in b.hold);

export function planLayoutPut(from: LayoutSnapshot, target: Board): PutPlan {
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
  const ops: ChangeOp[] = [...structure, ...prerequisites, ...carriedOps, ...comboOps];

  // Placement: a layer key with no counterpart is offered a key of the same hand, thumbs first, nearest the middle first. A free key
  // comes before one that holds a nearest-place guess, and a key carried with confidence is never offered (D-249: offered, not forced).
  const base = from.document.layers[0] as Layer;
  const sourceSlots = keySlots(from.board.definition, from.board.geometry).slots;
  const placeName = (p: number) => keyPlace(target.definition, p, target.geometry);
  const sourceNameAt = (p: number) => keyName(from.board.definition, from.document, { layerId: base.id, position: p }, { geometry: from.board.geometry, withLayer: false });
  const taken = new Set<number>();
  const replaced = new Set<number>();
  const placementOps: ChangeOp[] = [];
  for (const placement of placements) {
    const sourceSlot = sourceSlots.get(placement.source);
    if (sourceSlot === undefined) continue;
    const rank = (p: number) => {
      const slot = slots.get(p);
      const guess = baseCarried.get(p);
      return [guess === undefined ? 0 : 1, slot?.thumb === true ? 0 : 1, slot?.thumb === true ? slot.thumbRank : slotDistance(sourceSlot, slot)] as const;
    };
    placement.candidates = target.definition.hands[sourceSlot.hand]
      .filter((p) => !taken.has(p) && (baseCarried.get(p) === undefined || (baseCarried.get(p) as { confidence: number }).confidence < SURE))
      .sort((a, b) => {
        const [ra, rb] = [rank(a), rank(b)];
        return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || a - b;
      })
      .slice(0, 3)
      .map((p): PlacementCandidate => {
        const there = baseCarried.get(p);
        return { target: p, name: placeName(p), ...(there === undefined ? {} : { replaces: sourceNameAt(there.source) }) };
      });
    const first = placement.candidates[0];
    if (first === undefined) continue;
    const binding = base.bindings[placement.source] as Binding;
    const checkpoint = transfer.checkpoint();
    const result = transfer.bind(binding, binding.kind === "holdTap" ? tapOnly(binding.tap) : { kind: "none" }, first.target);
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
    if (baseCarried.has(first.target)) replaced.add(first.target);
    placementOps.push(op);
  }
  const kept = carriedOps.filter((o) => !(o.op === "setBinding" && o.at.layerId === "base" && replaced.has(o.at.position)));
  const opsWithPlacements: ChangeOp[] =
    placementOps.length === 0 ? [] : [...structure, ...dedupe([...transfer.prerequisiteOps(), ...comboPlan.ops.filter((o) => o.op !== "upsertCombo")]), ...kept, ...placementOps, ...comboOps];

  const notes = [...new Set(transfer.notes)];
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
