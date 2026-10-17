// Moving tri-layer code a stored layout kept as source into the model (D-390). Pure: the importers' parsers run elsewhere; this says which
// kept blocks that move replaces and whether a pair of documents differs only by it, which is what lets the sync engine call the two the
// same build.
import { deepEqual } from "./equal.ts";
import { withoutLayerNumbers } from "./layer-refs.ts";
import type { Layout, Passthrough } from "./schema.ts";

/** The anchor the QMK importer gives a kept `layer_state_set_user` (D-387). */
export const KEPT_LAYER_STATE_ANCHOR = "function:layer_state_set_user";

/** Kept source the backfill can replace: a QMK `layer_state_set_user`, or a ZMK root node that is a `zmk,conditional-layers` container. */
export const isKeptConditional = (p: Passthrough): boolean =>
  (p.firmware === "qmk" && p.file === "keymap.c" && p.anchor === KEPT_LAYER_STATE_ANCHOR) ||
  (p.firmware === "zmk" && p.anchor.startsWith("root:") && p.source.includes('"zmk,conditional-layers"'));

/**
 * Whether `after` is `before` with kept conditional code read into the model and nothing else different (layer numbers recorded on kept
 * code aside). It checks the shape of the step, not that the code and the conditions say the same thing: only the backfill makes this
 * step, because no op edits kept source.
 */
export function isConditionalBackfill(before: Layout, after: Layout): boolean {
  if (after.conditionalLayers.length <= before.conditionalLayers.length) return false;
  if (!deepEqual(after.conditionalLayers.slice(0, before.conditionalLayers.length), before.conditionalLayers)) return false;
  const kept = before.passthrough.filter(isKeptConditional);
  if (kept.length === 0) return false;
  const strip = (l: Layout, passthrough: Passthrough[]) => withoutLayerNumbers({ ...l, conditionalLayers: [], passthrough });
  return deepEqual(strip(before, before.passthrough.filter((p) => !isKeptConditional(p))), strip(after, after.passthrough));
}

/** Whether going from `before` to `after` generates the same firmware: only recorded layer numbers differ, or kept conditional code moved into the model. */
export const sameBuild = (before: Layout, after: Layout): boolean =>
  deepEqual(withoutLayerNumbers(before), withoutLayerNumbers(after)) || isConditionalBackfill(before, after);
