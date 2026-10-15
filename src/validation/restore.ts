// Going back to an earlier revision (D-170): the document is checked against the document rules,
// and only a problem the head doesn't already have refuses it, as evaluate() does for a change.
import type { BoardDefinition } from "../boards/schema.ts";
import type { Layout } from "../layout/schema.ts";
import type { Issue, ValidationResult } from "./result.ts";
import { documentRules } from "./rules.ts";

const key = (i: Issue) => JSON.stringify([i.code, i.message, i.slots ?? []]);

export function restoreProblems(board: BoardDefinition, head: Layout, target: Layout): ValidationResult {
  const known = new Set(documentRules(board, head).map(key));
  const errors = documentRules(board, target).filter((i) => !known.has(key(i)));
  return { ok: errors.length === 0, errors, warnings: [], diff: { changed: [], displaced: [], dropped: [], relearnCount: 0, retuned: [], reminders: [] } };
}
