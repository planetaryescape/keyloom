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

/**
 * A summary stored before keys were named by what they print (D-279), read without its key numbers: "Layer 0, key 25: X" is
 * "Layer 0: X", "Swapped Base key 1 (A) and …" is "Swapped A on Base and …", "on key 7 of Layer 0" is "on Layer 0". Newer summaries
 * have no numbers and pass through.
 */
export function withoutKeyNumbers(summary: string): string {
  return summary
    .replace(/(Layer \d+|[A-Z][\w-]*) key \d+ \(([^)]*)\)/g, "$2 on $1")
    .replace(/, keys? [\d, ]+:/g, ":")
    .replace(/on key \d+ of /g, "on ")
    .replace(/ \(key \d+\)/g, "")
    .replace(/(Layer \d+|[A-Z][\w-]*) key \d+\b/g, "$1")
    .replace(/\bkey \d+\b/gi, "a key");
}
