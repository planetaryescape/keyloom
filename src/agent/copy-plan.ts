// "Copy this from my other keyboard" worked out deterministically (D-221): which key goes where
// (boards/correspondence), what each copied binding becomes on the target (layout/transfer), and
// the ops that do it. The model still writes the proposal and decides what to ask BK; this is the
// part it would get wrong by counting positions on two different boards.
import { boardCapabilities, lightingRefusal } from "../boards/capabilities.ts";
import { type KeyMapping, type KeyMatch, type Strategy, mapKeys } from "../boards/correspondence.ts";
import { keySlots } from "../boards/key-slots.ts";
import type { ChangeOp } from "../layout/change.ts";
import { bindingFunctions } from "../layout/functions.ts";
import { type LayerMatch, matchLayers } from "../layout/layer-match.ts";
import { type Hand } from "../layout/mirror.ts";
import { bindingLabel } from "../layout/render-grid.ts";
import type { Binding, Layer, Layout } from "../layout/schema.ts";
import { BindingTransfer, type TransferEnv, transferLighting } from "../layout/transfer.ts";
import type { LayoutSnapshot } from "./ports.ts";

/** A match below this is shown but not carried, so a guess never becomes a change without BK seeing it. */
export const DEFAULT_MIN_CONFIDENCE = 0.6;

export const findLayer = (layout: Layout, ref: string): Layer => {
  const hit = layout.layers.find((l, i) => l.id === ref || l.name === ref || String(i) === ref);
  if (hit === undefined) throw new Error(`no layer "${ref}"; layers are: ${layout.layers.map((l) => `${l.id} ("${l.name}")`).join(", ")}`);
  return hit;
};

export function layerMatchFor(from: LayoutSnapshot, to: LayoutSnapshot): LayerMatch[] {
  return matchLayers(from.document, to.document);
}

export function mapLayer(from: LayoutSnapshot, to: LayoutSnapshot, fromLayerId: string, toLayerId: string, strategy: Strategy, layers: readonly LayerMatch[] = layerMatchFor(from, to)): KeyMapping {
  return mapKeys(
    { layout: from.document, board: from.board, layerId: fromLayerId },
    { layout: to.document, board: to.board, layerId: toLayerId },
    strategy,
    layers,
  );
}

/** The best key for each source key, or nothing: what a copy uses. Spare "also does this" keys are only for colours. */
export const primaryTargets = (mapping: KeyMapping, minConfidence: number, includeExtra: boolean): Map<number, KeyMatch[]> =>
  new Map(
    mapping.mapped.map((m) => [m.source, m.matches.filter((x) => x.confidence >= minConfidence && (includeExtra || !x.extra))] as const).filter(([, ms]) => ms.length > 0),
  );

export function transferEnv(from: LayoutSnapshot, to: LayoutSnapshot, layers: readonly LayerMatch[]): TransferEnv {
  const def = to.board.definition;
  const slots = keySlots(def, to.board.geometry).slots;
  const handAt = (p: number): Hand | null => slots.get(p)?.hand ?? null;
  return {
    source: from.document,
    target: to.document,
    layers: new Map(layers.flatMap((m) => (m.targetLayerId === null ? [] : [[m.sourceLayerId, m.targetLayerId] as const]))),
    handAt,
    fingerAt: (p) => slots.get(p)?.finger ?? null,
    // The other hand's keys and every thumb key: what the validator counts as "waits for the other hand" (07).
    sourceTriggerIsOppositeHand: (positions, hand) => {
      const src = from.board.definition;
      const other = src.hands[hand === "left" ? "right" : "left"];
      const thumbs = new Set(src.rows.thumb ?? []);
      return positions.length > 0 && positions.every((p) => other.includes(p) || thumbs.has(p));
    },
    triggerPositions: (hand) => [...new Set([...def.hands[hand === "left" ? "right" : "left"], ...(def.rows.thumb ?? [])])].sort((a, b) => a - b),
  };
}

export type BehaviourCopy = {
  ops: ChangeOp[];
  /** One line per source key: what it became, or why it was not copied. */
  steps: Array<{ source: number; target: number | null; outcome: { binding: Binding } | { unchanged: true } | { skip: string }; confidence: number | null }>;
  /** What translating hold-tap profiles for the target had to leave out (D-024); empty when the target runs the same firmware. */
  notes: string[];
};

/**
 * Sets each chosen source key's behaviour on its best target key. A key keeps its own letter (a
 * hold-tap carried onto A is still A when tapped), because a tap is a key's identity and the
 * behaviour is what BK asked to copy.
 */
export function planBehaviourCopy(from: LayoutSnapshot, to: LayoutSnapshot, mapping: KeyMapping, sourcePositions: readonly number[], layers: readonly LayerMatch[], minConfidence: number): BehaviourCopy {
  const sLayer = findLayer(from.document, mapping.sourceLayerId);
  const tLayer = findLayer(to.document, mapping.targetLayerId);
  const transfer = new BindingTransfer(transferEnv(from, to, layers));
  const ctx = { layers: to.document.layers, macros: to.document.macros, tapDances: to.document.tapDances };
  const targets = primaryTargets(mapping, minConfidence, false);
  const lowest = new Map(mapping.mapped.map((m) => [m.source, m.matches.find((x) => !x.extra)] as const));
  const steps: BehaviourCopy["steps"] = [];
  const setOps: ChangeOp[] = [];
  const claimed = new Set<number>();
  for (const source of [...new Set(sourcePositions)].sort((a, b) => a - b)) {
    const binding = sLayer.bindings[source];
    if (binding === undefined) {
      steps.push({ source, target: null, outcome: { skip: "the source layout has no such key" }, confidence: null });
      continue;
    }
    const match = targets.get(source)?.[0];
    if (match === undefined) {
      const weak = lowest.get(source);
      steps.push({ source, target: null, confidence: weak?.confidence ?? null, outcome: { skip: weak ? `the best match (key ${weak.target + 1}) is only a ${Math.round(weak.confidence * 100)}% guess, which is too weak to apply without asking` : "no key on the target does this job or sits in this place" } });
      continue;
    }
    const targetBinding = tLayer.bindings[match.target] as Binding;
    const checkpoint = transfer.checkpoint();
    const result = transfer.bind(binding, targetBinding, match.target);
    const skip = (why: string) => {
      transfer.rollback(checkpoint);
      steps.push({ source, target: match.target, outcome: { skip: why }, confidence: match.confidence });
    };
    if ("skip" in result) {
      skip(result.skip);
      continue;
    }
    if (claimed.has(match.target)) {
      skip(`another copied key already lands on key ${match.target + 1}`);
      continue;
    }
    // A copy never quietly replaces something else the target key does; the key keeping its own tap is the one exception.
    const kept = new Set(bindingFunctions(result.binding, to.document.tapDances));
    const lost = bindingFunctions(targetBinding, to.document.tapDances).filter((f) => !kept.has(f));
    if (lost.length > 0) {
      skip(`key ${match.target + 1} already does something else (${bindingLabel(targetBinding, ctx)}), and copying here would replace it; ask BK where this should go`);
      continue;
    }
    claimed.add(match.target);
    if (JSON.stringify(result.binding) === JSON.stringify(targetBinding)) {
      transfer.rollback(checkpoint);
      steps.push({ source, target: match.target, outcome: { unchanged: true }, confidence: match.confidence });
      continue;
    }
    setOps.push({ op: "setBinding", at: { layerId: tLayer.id, position: match.target }, binding: result.binding });
    steps.push({ source, target: match.target, outcome: { binding: result.binding }, confidence: match.confidence });
  }
  return { ops: [...transfer.prerequisiteOps(), ...setOps], steps, notes: [...new Set(transfer.notes)] };
}

export type LightingCopy = {
  ops: ChangeOp[];
  layers: Array<{ source: string; target: string | null; carried: number; lost: number[]; why?: string }>;
};

/** Throws the board's own sentence when the target cannot show per-key colours; nothing else is attempted then. */
export function assertCanLight(to: LayoutSnapshot): void {
  if (!boardCapabilities(to.board.definition).lighting.supported) throw new Error(`${lightingRefusal(to.board.definition)} There is nothing to propose; tell BK this plainly.`);
}

/** One setLayerLighting per source layer that has colours and a matching target layer. A target layer's own colours are replaced as a whole. */
export function planLightingCopy(from: LayoutSnapshot, to: LayoutSnapshot, layers: readonly LayerMatch[], strategy: Strategy, onlyLayerIds: readonly string[] | null, minConfidence: number): LightingCopy {
  assertCanLight(to);
  const ops: ChangeOp[] = [];
  const report: LightingCopy["layers"] = [];
  for (const layer of from.document.layers) {
    if (onlyLayerIds !== null && !onlyLayerIds.includes(layer.id)) continue;
    if (layer.lighting === undefined) continue;
    const match = layers.find((m) => m.sourceLayerId === layer.id);
    if (match === undefined || match.targetLayerId === null) {
      report.push({ source: layer.id, target: null, carried: 0, lost: [], why: `${layer.name} has colours, but no layer of the target does the same job` });
      continue;
    }
    const mapping = mapLayer(from, to, layer.id, match.targetLayerId, strategy, layers);
    const targets = new Map([...primaryTargets(mapping, minConfidence, true)].map(([s, ms]) => [s, ms.map((m) => m.target)] as const));
    const result = transferLighting(layer.lighting, targets);
    ops.push({ op: "setLayerLighting", layerId: match.targetLayerId, lighting: result.lighting });
    report.push({ source: layer.id, target: match.targetLayerId, carried: result.carried.length, lost: result.lost });
  }
  return { ops, layers: report };
}

export type ComboCopy = {
  ops: ChangeOp[];
  steps: Array<{ comboId: string; outcome: { copied: string } | { skip: string } }>;
};

export function planComboCopy(from: LayoutSnapshot, to: LayoutSnapshot, mapping: KeyMapping, comboIds: readonly string[], layers: readonly LayerMatch[], minConfidence: number): ComboCopy {
  const transfer = new BindingTransfer(transferEnv(from, to, layers));
  const targets = primaryTargets(mapping, minConfidence, false);
  const taken = new Set(to.document.combos.map((c) => c.id));
  const ops: ChangeOp[] = [];
  const steps: ComboCopy["steps"] = [];
  const setOps: ChangeOp[] = [];
  const layerMap = new Map(layers.flatMap((m) => (m.targetLayerId === null ? [] : [[m.sourceLayerId, m.targetLayerId] as const])));
  for (const id of comboIds) {
    const combo = from.document.combos.find((c) => c.id === id);
    if (combo === undefined) {
      steps.push({ comboId: id, outcome: { skip: `the source layout has no combo "${id}"; its combos are: ${from.document.combos.map((c) => c.id).join(", ") || "none"}` } });
      continue;
    }
    const mapped = combo.positions.map((p) => targets.get(p)?.[0]?.target);
    if (mapped.some((m) => m === undefined)) {
      steps.push({ comboId: id, outcome: { skip: `key ${combo.positions[mapped.findIndex((m) => m === undefined)]! + 1} has no confident counterpart on the target` } });
      continue;
    }
    const positions = [...new Set(mapped as number[])].sort((a, b) => a - b);
    if (positions.length < 2) {
      steps.push({ comboId: id, outcome: { skip: "its keys land on the same key of the target" } });
      continue;
    }
    // A combo's modifier belongs to the combo, not to a hand, so it is copied as written (position -1 has no hand).
    const checkpoint = transfer.checkpoint();
    const output = transfer.bind(combo.output, combo.output, -1);
    if ("skip" in output) {
      transfer.rollback(checkpoint);
      steps.push({ comboId: id, outcome: output });
      continue;
    }
    const layerIds = combo.layerIds === "all" ? "all" : combo.layerIds.flatMap((l) => (layerMap.has(l) ? [layerMap.get(l) as string] : []));
    if (layerIds !== "all" && layerIds.length === 0) {
      transfer.rollback(checkpoint);
      steps.push({ comboId: id, outcome: { skip: "none of the layers it works on has a counterpart on the target" } });
      continue;
    }
    let newId = combo.id;
    for (let n = 2; taken.has(newId); n++) newId = `${combo.id}-${n}`;
    taken.add(newId);
    setOps.push({ op: "upsertCombo", combo: { ...combo, id: newId, positions, layerIds, output: output.binding } });
    steps.push({ comboId: id, outcome: { copied: newId } });
  }
  ops.push(...transfer.prerequisiteOps(), ...setOps);
  return { ops, steps };
}
