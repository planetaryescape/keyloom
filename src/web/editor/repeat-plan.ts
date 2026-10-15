// "Repeat last change on selection" worked out for the panel (09, D-061): the editor's last change,
// reduced to a transform (src/layout/repeat.ts) and applied to each selected key. Pure, so the
// rules are tested without a browser.
import type { ChangeOp } from "../../layout/change.ts";
import { applyRepeat, repeatTransform, type RepeatTransform } from "../../layout/repeat.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import { bindingSummary, changeSummary } from "./draft.ts";

/** What the editor last applied to one key. */
export type LastChange = { layerId: string; position: number; before: Binding; after: Binding };

export type RepeatRow =
  | { position: number; kind: "change"; before: Binding; after: Binding }
  | { position: number; kind: "same" }
  | { position: number; kind: "skip"; reason: string };

export type RepeatPlan = { transform: RepeatTransform | null; rows: RepeatRow[]; ops: ChangeOp[] };

export function planRepeat(layout: Layout, layerId: string, positions: readonly number[], last: LastChange): RepeatPlan {
  const transform = repeatTransform(last.before, last.after);
  const layer = layout.layers.find((l) => l.id === layerId);
  if (transform === null || layer === undefined) return { transform, rows: [], ops: [] };
  const rows = [...positions].sort((a, b) => a - b).map((position): RepeatRow => {
    const before = layer.bindings[position];
    if (before === undefined) return { position, kind: "skip", reason: "this layer has no such key" };
    const outcome = applyRepeat(transform, before);
    if ("skip" in outcome) return { position, kind: "skip", reason: outcome.skip };
    if ("unchanged" in outcome) return { position, kind: "same" };
    return { position, kind: "change", before, after: outcome.binding };
  });
  const ops = rows.flatMap((row): ChangeOp[] => (row.kind === "change" ? [{ op: "setBinding", at: { layerId, position: row.position }, binding: row.after }] : []));
  return { transform, rows, ops };
}

/** The sentence under the panel's title: what the last change was, and what repeating it means. */
export function repeatMeaning(layout: Layout, last: LastChange, transform: RepeatTransform): string {
  const was = changeSummary(layout, last.layerId, last.position, last.after);
  switch (transform.kind) {
    case "rewrap": return `${was}. Each selected key gets the same hold and keeps its own letter.`;
    case "unwrap": return `${was}. Each selected key loses its hold and keeps its own letter.`;
    case "copy": return `${was}. Each selected key is set to ${bindingSummary(transform.binding, layout)}.`;
  }
}

/** The change set's summary, as it reads in the revision history. */
export function repeatSummary(layout: Layout, layerId: string, plan: RepeatPlan): string {
  const layerName = layout.layers.find((l) => l.id === layerId)?.name ?? layerId;
  const keys = plan.rows.flatMap((row) => (row.kind === "change" ? [`${row.position + 1}`] : []));
  return `${layerName}, keys ${keys.join(", ")}: repeated the last change`;
}
