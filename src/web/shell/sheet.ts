// The side panel on a narrow screen is a bottom sheet with three heights (18#phones-and-narrow-windows). The numbers
// live here, and the stylesheet reads them through --sheet-h, so a drag, a button and the page's own scroll room agree.
export const SHEET_SIZES = ["peek", "half", "full"] as const;
export type SheetSize = (typeof SHEET_SIZES)[number];

// Peek shows the grabber and the panel's title row; half leaves the board above it; full leaves the header.
const PEEK_PX = 112;
const HALF_RATIO = 0.46;
const HALF_MAX_PX = 460;
const FULL_RATIO = 0.86;

export function sheetHeight(size: SheetSize, viewportHeight: number): number {
  switch (size) {
    case "peek": return PEEK_PX;
    case "half": return Math.round(Math.min(viewportHeight * HALF_RATIO, HALF_MAX_PX));
    case "full": return Math.round(viewportHeight * FULL_RATIO);
  }
}

/** The height a drag can reach: never under peek, never over full. */
export function clampSheet(px: number, viewportHeight: number): number {
  return Math.min(Math.max(px, PEEK_PX), sheetHeight("full", viewportHeight));
}

/** The size whose height is nearest to where a drag ended. */
export function nearestSize(px: number, viewportHeight: number): SheetSize {
  let best: SheetSize = "half";
  let distance = Infinity;
  for (const size of SHEET_SIZES) {
    const gap = Math.abs(sheetHeight(size, viewportHeight) - px);
    if (gap < distance) {
      best = size;
      distance = gap;
    }
  }
  return best;
}

export const taller = (size: SheetSize): SheetSize => SHEET_SIZES[Math.min(SHEET_SIZES.indexOf(size) + 1, SHEET_SIZES.length - 1)] as SheetSize;
export const shorter = (size: SheetSize): SheetSize => SHEET_SIZES[Math.max(SHEET_SIZES.indexOf(size) - 1, 0)] as SheetSize;
