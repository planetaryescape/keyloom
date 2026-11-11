// The History panel's list (18#words, D-102): a layout's revisions, newest first.
import { type RevisionRow, findLayoutRow, findRevision, revisionChain } from "../persistence/layouts.ts";
import { showBoard } from "./boards.ts";
import type { App } from "./context.ts";
import { NotFoundError } from "./errors.ts";

export function listRevisions(app: App, ref: string): RevisionRow[] {
  const layout = findLayoutRow(app.db, ref);
  if (!layout) throw new NotFoundError(`no layout "${ref}"`);
  return revisionChain(app.db, layout.id, layout.headRevisionId);
}

/**
 * The newest earlier revision whose every layer has one binding per key of its board, or null (R1-20, D-502). A layout the editor
 * can't draw has no History panel to pick one from, so the page offers this one revision to go back to. A board whose own drawing
 * disagrees with its key count fits no revision, so the answer is null.
 */
export function lastFittingRevision(app: App, ref: string): RevisionRow | null {
  const layout = findLayoutRow(app.db, ref);
  if (!layout) throw new NotFoundError(`no layout "${ref}"`);
  const board = showBoard(layout.boardId);
  const keys = board.geometry.keys.length;
  if (board.definition.keyCount !== keys) return null;
  for (const row of revisionChain(app.db, layout.id, layout.headRevisionId).slice(1)) {
    const found = findRevision(app.db, layout.id, row.id);
    if (found && found.layout.layers.every((layer) => layer.bindings.length === keys)) return row;
  }
  return null;
}
