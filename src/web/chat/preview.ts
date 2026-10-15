// What the board shows while a proposal is hovered, focused or pinned: the layout with the proposal's
// ops applied (by the same pure validator the server runs), the layer that has the change, and which
// keys to mark. Pure, so the choice of layer and marks is tested without a browser.
import type { ProposalCard } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Slot } from "../../layout/change.ts";
import type { Layout } from "../../layout/schema.ts";
import { evaluate } from "../../validation/validate.ts";

export type Mark = "changed" | "home";

export interface Preview {
  /** The layout with the proposal applied; the head itself when the proposal no longer applies cleanly. */
  layout: Layout;
  /** The layer to draw: the one the person is on if it has a change, else the first layer that does. */
  layerId: string;
  changed: Slot[];
  /** Where displaced functions end up. */
  homes: Slot[];
}

export function previewProposal(board: BoardDefinition, head: Layout, proposal: ProposalCard, currentLayerId: string): Preview {
  const evaluation = evaluate(board, head, proposal.ops);
  // A proposal made against an older head can fail to apply now; the stored diff still says which keys it meant.
  const diff = evaluation.after === null ? proposal.validation.diff : evaluation.result.diff;
  const known = new Set(head.layers.map((layer) => layer.id));
  const changed = diff.changed.filter((slot) => known.has(slot.layerId));
  const layerId = changed.some((slot) => slot.layerId === currentLayerId) ? currentLayerId : (changed[0]?.layerId ?? currentLayerId);
  const homes = diff.displaced.flatMap((moved) => (moved.to === null ? [] : [moved.to]));
  return { layout: evaluation.after ?? head, layerId, changed, homes };
}

/** The marks to draw on `layerId`: a changed key outranks a displaced function's new home. */
export function marksOn(preview: Preview | null, layerId: string): Map<number, Mark> {
  const marks = new Map<number, Mark>();
  if (preview === null) return marks;
  for (const slot of preview.homes) if (slot.layerId === layerId) marks.set(slot.position, "home");
  for (const slot of preview.changed) if (slot.layerId === layerId) marks.set(slot.position, "changed");
  return marks;
}
