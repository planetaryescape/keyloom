// The keys picked on the board, on one layer (16#combos-are-made-from-a-selection). Pure, so the
// rules for Shift-click are tested without a browser.
export interface KeySelection {
  layerId: string;
  /** Ascending, so "in order" means board order whatever order they were clicked in. */
  positions: number[];
}

/**
 * Shift-click on `position`. A selection on another layer starts over. The first Shift-click also
 * takes in the key whose panel is open (`open`), since "click J, Shift-click K" means both.
 * Returns null when the last key is taken out.
 */
export function extendSelection(previous: KeySelection | null, layerId: string, position: number, open: number | null): KeySelection | null {
  const base = previous !== null && previous.layerId === layerId ? previous.positions : [];
  const seed = base.length === 0 && open !== null && open !== position ? [open] : [];
  const start = [...base, ...seed];
  const positions = (start.includes(position) ? start.filter((candidate) => candidate !== position) : [...start, position]).sort((a, b) => a - b);
  return positions.length === 0 ? null : { layerId, positions };
}
