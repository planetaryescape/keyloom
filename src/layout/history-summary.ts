// The prefixes an undo gives a revision's summary ("Undo: ", "Redo: ", "Back to: "), kept from stacking
// into "Back to: Redo: Back to: X" when an undo is itself undone or gone back to.
const PREFIXES = /^((?:Back to|Redo|Undo): )+/;

/** A summary without any of those prefixes: the change itself. */
export function plainSummary(summary: string): string {
  return summary.replace(PREFIXES, "");
}

/** The first prefix and the change, so a summary stored with a stack of prefixes reads with one. */
export function tidySummary(summary: string): string {
  const stack = PREFIXES.exec(summary)?.[0];
  if (stack === undefined) return summary;
  const first = /^(?:Back to|Redo|Undo): /.exec(stack)?.[0] ?? "";
  return `${first}${summary.slice(stack.length)}`;
}
