// The warning for a proposal made from a selection (07#warnings, D-062). BK picked keys on the
// picture to say where the change belongs; a proposal that edits others has left that scope.
// It is a warning because the agent may have a good reason (a displaced function needs a home),
// and the preview should make BK see it, not forbid it.
import { keyIn } from "./words.ts";
import type { Slot } from "../layout/change.ts";
import type { Layout } from "../layout/schema.ts";
import type { Issue } from "./result.ts";

/** The keys selected when the message was sent: one layer, by position. */
export type SelectionScope = { layerId: string; positions: readonly number[] };

const LISTED = 6;

const slotText = (doc: Layout, s: Slot): string => keyIn(doc, s);

/** `outside_selection`: the change edits keys that were not in the selection. Empty when it stays inside. */
export function outsideSelection(before: Layout, changed: readonly Slot[], selection: SelectionScope): Issue[] {
  const inside = new Set(selection.positions);
  const outside = changed.filter((s) => s.layerId !== selection.layerId || !inside.has(s.position));
  if (outside.length === 0) return [];
  const named = outside.slice(0, LISTED).map((s) => slotText(before, s)).join("; ");
  const more = outside.length > LISTED ? `; and ${outside.length - LISTED} more` : "";
  return [{
    code: "outside_selection",
    message: `This change edits ${outside.length} ${outside.length === 1 ? "key" : "keys"} you did not select: ${named}${more}`,
    plain: `This change edits ${outside.length} ${outside.length === 1 ? "key" : "keys"} you did not select: ${named}${more}.`,
    slots: [...outside],
  }];
}
