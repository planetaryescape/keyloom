// The validator (07): a pure function from a board, a layout and ops to a result. The agent
// and the editor both call it, and apply calls it again against the head (D-014).
import type { BoardDefinition } from "../boards/schema.ts";
import { effectiveSensors, withSensorDefaults } from "../boards/sensors.ts";
import { applyOps } from "../layout/apply-ops.ts";
import { type ChangeOp, ChangeOpSchema, type Slot } from "../layout/change.ts";
import { deepEqual } from "../layout/equal.ts";
import { type Binding, type Layout, LayoutSchema } from "../layout/schema.ts";
import { conditionalLayerWarnings } from "./conditional-layer-rules.ts";
import { type DecisionFact, contradictsDecision, touchedDecisions } from "./decision-rules.ts";
import { homerowSameHandMods, retunedSlots } from "./hold-tap-rules.ts";
import { identifierClash } from "./identifier-rules.ts";
import type { Issue, ValidationResult } from "./result.ts";
import { type PinnedPriority, largeRelearn, movedPinned } from "./priority-rules.ts";
import { displacedFunctions, functionHomes, reachableLayers, relearned } from "./reachability.ts";
import { macroSecrets, tapDanceWarnings } from "./tap-dance-rules.ts";
import { documentRules, doubledLetterTapdance, functionLost, nativeEdit, nativeLighting, passthroughLayerIndex, riskyNatives } from "./rules.ts";
import { type SelectionScope, outsideSelection } from "./selection-rules.ts";

const NO_DIFF: ValidationResult["diff"] = { changed: [], displaced: [], dropped: [], relearnCount: 0, retuned: [], reminders: [] };

const failed = (errors: Issue[]): Evaluation => ({ result: { ok: false, errors, warnings: [], diff: NO_DIFF }, after: null, touched: [] });

const issueKey = (i: Issue) => JSON.stringify([i.code, i.message, i.slots ?? []]);

const danceOf = (doc: Layout, b: Binding | undefined) => (b?.kind === "tapDance" ? doc.tapDances.find((t) => t.id === b.tapDanceId) : undefined);

/** Slots whose binding differs, or whose tap dance entry does. Layers that exist on only one side have no slot to compare, so they aren't listed. */
function changedSlots(before: Layout, after: Layout): Slot[] {
  const out: Slot[] = [];
  for (const layer of after.layers) {
    const was = before.layers.find((l) => l.id === layer.id);
    if (!was) continue;
    for (const [position, binding] of layer.bindings.entries()) {
      // A tap dance key keeps its binding when its entry changes, but it is not the same key.
      const wasBinding = was.bindings[position];
      if (!deepEqual(binding, wasBinding) || !deepEqual(danceOf(after, binding), danceOf(before, wasBinding))) out.push({ layerId: layer.id, position });
    }
  }
  return out;
}

/**
 * The result, and the document the ops produce when it parses (null when it doesn't). Apply saves
 * exactly this document. `touched` is every active choice decision the change touches, including
 * ones too settled to raise a reminder, because apply supersedes all of them (08).
 */
export type Evaluation = { result: ValidationResult; after: Layout | null; touched: { decisionId: string; slots: Slot[] }[] };

/** What the layout alone can't tell the validator: priorities BK has stated and decisions kept (08). The browser's own check passes none. */
export type EvaluationContext = { pinned?: readonly PinnedPriority[]; decisions?: readonly DecisionFact[]; selection?: SelectionScope };

/**
 * Everything the validator would warn about in a layout as it stands: the rules above that otherwise fire only for what a change adds,
 * here read against the layout alone. The board review turns each into an item (D-340).
 */
export const standingIssues = (board: BoardDefinition, doc: Layout): Issue[] => [
  ...documentRules(board, doc), ...doubledLetterTapdance(doc), ...tapDanceWarnings(doc), ...macroSecrets(doc), ...homerowSameHandMods(board, doc), ...conditionalLayerWarnings(doc),
  ...identifierClash(doc),
];

export const validate = (board: BoardDefinition, before: Layout, ops: readonly ChangeOp[], context: EvaluationContext = {}): ValidationResult =>
  evaluate(board, before, ops, context).result;

export function evaluate(board: BoardDefinition, before: Layout, ops: readonly ChangeOp[], context: EvaluationContext = {}): Evaluation {
  // Apply the parsed ops, not the callers' objects: zod strips unknown fields, and an unstripped
  // extra field on a binding would otherwise be saved into the document.
  const clean: ChangeOp[] = [];
  const opErrors: Issue[] = [];
  for (const [i, op] of ops.entries()) {
    const r = ChangeOpSchema.safeParse(op);
    if (r.success) clean.push(r.data);
    else opErrors.push({ code: "schema", message: `op ${i}: ${r.error.issues.map((x) => `${x.path.join(".") || "op"} ${x.message}`).join("; ")}`, plain: "keyloom couldn't read part of this change." });
  }
  if (opErrors.length) return failed(opErrors);

  const applied = applyOps(before, clean);
  if (!applied.ok) return failed([{ code: applied.error.code, message: `op ${applied.error.index}: ${applied.error.message}`, plain: "This change refers to something that isn't in the layout." }]);

  const schema = LayoutSchema.safeParse(applied.layout);
  if (!schema.success) {
    return failed(schema.error.issues.map((x) => ({ code: "schema", message: `${x.path.join(".") || "document"}: ${x.message}`, plain: "This change would leave the layout in a shape keyloom can't save." })));
  }
  const after = schema.data;

  // A layout imported with a flaw of its own must stay editable, so a problem that was already
  // there, identical, is shown as a warning. A change that moves or worsens it is an error.
  const existing = new Set(documentRules(board, before).map(issueKey));
  const beforeLayers = new Set(before.layers.map((l) => l.id));
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  for (const i of documentRules(board, after)) {
    if (existing.has(issueKey(i))) warnings.push({ ...i, message: `${i.message} (already so before this change)`, ...(i.plain === undefined ? {} : { plain: `${i.plain} It was already like this before your change.` }) });
    // A layer this change adds has lost nothing by being out of reach, so the tabs' "add" and "duplicate" can make one (D-181);
    // a layer that was reachable and stops being so keeps being an error.
    else if (i.code === "layer_unreachable" && i.layerId !== undefined && !beforeLayers.has(i.layerId)) {
      warnings.push({ ...i, plain: `${i.plain ?? i.message} Add a key that switches to it before you rely on it.` });
    } else errors.push(i);
  }
  const analyzedBefore = withSensorDefaults(board, before);
  const analyzedAfter = withSensorDefaults(board, after);
  errors.push(...nativeEdit(analyzedBefore, analyzedAfter), ...passthroughLayerIndex(before, after));
  errors.push(...nativeLighting(board, before, after));
  warnings.push(...riskyNatives(board, before, after));

  const lost = functionLost(analyzedBefore, analyzedAfter, clean);
  errors.push(...lost.errors);
  // Only a tap dance this change adds or moves is news; one already in the layout isn't the change's doing.
  const knownDances = new Set(doubledLetterTapdance(before).map(issueKey));
  warnings.push(...doubledLetterTapdance(after).filter((i) => !knownDances.has(issueKey(i))));

  // The same for a tap dance that does less than it looks like: only one this change adds or alters is news.
  const knownSame = new Set([...tapDanceWarnings(before), ...macroSecrets(before)].map(issueKey));
  warnings.push(...[...tapDanceWarnings(after), ...macroSecrets(after)].filter((i) => !knownSame.has(issueKey(i))));

  // A condition kanata can't write is news when this change adds it, not on every edit after.
  const knownConditions = new Set(conditionalLayerWarnings(before).map(issueKey));
  warnings.push(...conditionalLayerWarnings(after).filter((i) => !knownConditions.has(issueKey(i))));

  const changed = changedSlots(before, after);
  const previousLayers = new Map(before.layers.map((layer) => [layer.id, layer]));
  for (const layer of after.layers) {
    const was = previousLayers.get(layer.id);
    if (!was) continue;
    const oldSensors = effectiveSensors(board, was);
    const newSensors = effectiveSensors(board, layer);
    newSensors.forEach((sensor, index) => {
      const position = board.sensorPositions?.[index];
      if (position !== undefined && !deepEqual(oldSensors[index], sensor) && !changed.some((s) => s.layerId === layer.id && s.position === position)) changed.push({ layerId: layer.id, position });
    });
  }
  const beforeHomes = functionHomes(analyzedBefore, reachableLayers(before));
  const afterHomes = functionHomes(analyzedAfter, reachableLayers(after));
  const relearnCount = relearned(beforeHomes, afterHomes);
  warnings.push(...movedPinned(before, changed, beforeHomes, afterHomes, context.pinned ?? []), ...largeRelearn(relearnCount));
  if (context.selection) warnings.push(...outsideSelection(before, changed, context.selection));

  // Only a hazard this change adds is news; a layout imported with home-row mods already rolling into each other isn't nagged on every edit.
  const knownRolls = new Set(homerowSameHandMods(board, before).map(issueKey));
  warnings.push(...homerowSameHandMods(board, after).filter((i) => !knownRolls.has(issueKey(i))));

  // A name that would clash in the generated firmware is news only when this change introduces it: a layout
  // imported with one already is shown by the board review, not on every later edit.
  const knownClashes = new Set(identifierClash(before).map(issueKey));
  warnings.push(...identifierClash(after).filter((i) => !knownClashes.has(issueKey(i))));

  const retuned = retunedSlots(before, after, changed);
  const afterLayerIds = new Set(after.layers.map((l) => l.id));
  const touched = touchedDecisions(context.decisions ?? [], {
    changed, retuned, beforeHomes, afterHomes,
    removedLayerIds: new Set(before.layers.map((l) => l.id).filter((id) => !afterLayerIds.has(id))),
  });
  const remembered = contradictsDecision(before, touched);
  warnings.push(...remembered.warnings);

  return {
    result: {
      ok: errors.length === 0,
      errors,
      warnings,
      diff: {
        changed,
        displaced: displacedFunctions(before, after, changed, beforeHomes, afterHomes),
        dropped: lost.dropped,
        relearnCount,
        retuned,
        reminders: remembered.reminders,
      },
    },
    after,
    touched: touched.map((t) => ({ decisionId: t.fact.decisionId, slots: t.slots })),
  };
}
