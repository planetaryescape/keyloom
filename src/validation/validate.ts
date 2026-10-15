// The validator (07): a pure function from a board, a layout and ops to a result. The agent
// and the editor both call it, and apply calls it again against the head (D-014).
import type { BoardDefinition } from "../boards/schema.ts";
import { applyOps } from "../layout/apply-ops.ts";
import { type ChangeOp, ChangeOpSchema, type Slot } from "../layout/change.ts";
import { deepEqual } from "../layout/equal.ts";
import { type Layout, LayoutSchema } from "../layout/schema.ts";
import type { Issue, ValidationResult } from "./result.ts";
import { documentRules, nativeEdit, passthroughLayerIndex } from "./rules.ts";

const NO_DIFF: ValidationResult["diff"] = { changed: [], displaced: [], dropped: [], relearnCount: 0, reminders: [] };

const failed = (errors: Issue[]): Evaluation => ({ result: { ok: false, errors, warnings: [], diff: NO_DIFF }, after: null });

const issueKey = (i: Issue) => JSON.stringify([i.code, i.message, i.slots ?? []]);

/** Slots whose binding differs. Layers that exist on only one side have no slot to compare, so they aren't listed. */
function changedSlots(before: Layout, after: Layout): Slot[] {
  const out: Slot[] = [];
  for (const layer of after.layers) {
    const was = before.layers.find((l) => l.id === layer.id);
    if (!was) continue;
    for (const [position, binding] of layer.bindings.entries()) {
      if (!deepEqual(binding, was.bindings[position])) out.push({ layerId: layer.id, position });
    }
  }
  return out;
}

/** The result, and the document the ops produce when it parses (null when it doesn't). Apply saves exactly this document. */
export type Evaluation = { result: ValidationResult; after: Layout | null };

export const validate = (board: BoardDefinition, before: Layout, ops: readonly ChangeOp[]): ValidationResult =>
  evaluate(board, before, ops).result;

export function evaluate(board: BoardDefinition, before: Layout, ops: readonly ChangeOp[]): Evaluation {
  // Apply the parsed ops, not the callers' objects: zod strips unknown fields, and an unstripped
  // extra field on a binding would otherwise be saved into the document.
  const clean: ChangeOp[] = [];
  const opErrors: Issue[] = [];
  for (const [i, op] of ops.entries()) {
    const r = ChangeOpSchema.safeParse(op);
    if (r.success) clean.push(r.data);
    else opErrors.push({ code: "schema", message: `op ${i}: ${r.error.issues.map((x) => `${x.path.join(".") || "op"} ${x.message}`).join("; ")}` });
  }
  if (opErrors.length) return failed(opErrors);

  const applied = applyOps(before, clean);
  if (!applied.ok) return failed([{ code: applied.error.code, message: `op ${applied.error.index}: ${applied.error.message}` }]);

  const schema = LayoutSchema.safeParse(applied.layout);
  if (!schema.success) {
    return failed(schema.error.issues.map((x) => ({ code: "schema", message: `${x.path.join(".") || "document"}: ${x.message}` })));
  }
  const after = schema.data;

  // A layout imported with a flaw of its own must stay editable, so a problem that was already
  // there, identical, is shown as a warning. A change that moves or worsens it is an error.
  const existing = new Set(documentRules(board, before).map(issueKey));
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  for (const i of documentRules(board, after)) {
    if (existing.has(issueKey(i))) warnings.push({ ...i, message: `${i.message} (already so before this change)` });
    else errors.push(i);
  }
  errors.push(...nativeEdit(before, after), ...passthroughLayerIndex(before, after));

  return {
    result: {
      ok: errors.length === 0,
      errors,
      warnings,
      // displaced, dropped, relearnCount and reminders need the function graph (rung 3: reachability.ts) and decisions (rung 6).
      diff: { ...NO_DIFF, changed: changedSlots(before, after) },
    },
    after,
  };
}
