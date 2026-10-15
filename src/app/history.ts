// The History panel's list (18#words, D-102): a layout's revisions, newest first.
import { type RevisionRow, findLayoutRow, revisionChain } from "../persistence/layouts.ts";
import type { App } from "./context.ts";
import { NotFoundError } from "./errors.ts";

export function listRevisions(app: App, ref: string): RevisionRow[] {
  const layout = findLayoutRow(app.db, ref);
  if (!layout) throw new NotFoundError(`no layout "${ref}"`);
  return revisionChain(app.db, layout.id, layout.headRevisionId);
}
