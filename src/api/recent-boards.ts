// The boards on the home wall (D-476): the most recently opened, one config per board. The rule lives beside the wire contract so the
// CLI's `keyloom layout recent` and the web's pegboard can't disagree about which boards hang there or in what order.

/** How many boards the wall holds. */
export const WALL_SIZE = 4;

type Openable = { id: string; boardId: string; updatedAt: number; openedAt?: number | null | undefined; archivedAt?: number | null | undefined };

/**
 * Newest first, at most `limit`, one entry per board: the config of that board opened last. A config never opened counts from its last
 * edit, so a data directory from before opens were recorded still fills the wall instead of showing an empty one. Archived configs
 * never hang.
 */
export function recentBoards<T extends Openable>(layouts: readonly T[], limit = WALL_SIZE): T[] {
  const seen = (layout: T) => layout.openedAt ?? layout.updatedAt;
  const newestPerBoard = new Map<string, T>();
  for (const layout of layouts) {
    if (layout.archivedAt !== null && layout.archivedAt !== undefined) continue;
    const held = newestPerBoard.get(layout.boardId);
    // Ties go to the ID, so the order is the same on every read.
    if (held === undefined || seen(layout) > seen(held) || (seen(layout) === seen(held) && layout.id > held.id)) newestPerBoard.set(layout.boardId, layout);
  }
  return [...newestPerBoard.values()].sort((a, b) => seen(b) - seen(a) || b.id.localeCompare(a.id)).slice(0, limit);
}
