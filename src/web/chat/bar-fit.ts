import { type RefObject, useLayoutEffect, useState } from "react";

// How the command bar and the board share the stage (P3 review). The board keeps the unit it rests at, so its legends keep their
// floor; the bar sits over the empty stage below it. When that isn't enough room, the board moves up (into the caption's row where the
// caption doesn't sit beside it, as comp d does). When even that can't make room for the bar, the bar folds to one line.

/** The bar's height in comp d: the person's message, the reply, the change chips, the foot with Apply, and the input. */
export const FULL_BAR_PX = 300;
/** Below this the full bar can't show a reply and its Apply together, so it folds to one line. */
export const MIN_FULL_BAR_PX = 220;
/** The folded bar: one row with the option and Apply, or the input. */
export const LINE_BAR_PX = 56;
const GAP_PX = 12;
// How far the caption's words must stay from the board's left edge for the board to rise beside them.
const CAPTION_CLEAR_PX = 8;
const BOTTOM_PX = 16;

export interface BarFit {
  /** How far the board moves up, in px. */
  lift: number;
  /** The height the bar may use, in px. */
  room: number;
  /** Too little room for the full bar: one line instead. */
  collapsed: boolean;
}

export interface StageBoxes {
  stage: { top: number; bottom: number };
  /** The board where it rests, before any lift. */
  board: { top: number; bottom: number; left: number };
  caption: { bottom: number; right: number } | null;
}

/** Pure, so the rule can be tested without a browser. */
export function fitBar({ stage, board, caption }: StageBoxes): BarFit {
  // Beside the caption, the board may rise to the stage's top; under it, only to the caption's foot.
  const ceiling = caption !== null && caption.right + CAPTION_CLEAR_PX > board.left ? caption.bottom + 8 : stage.top + GAP_PX;
  const maxLift = Math.max(0, board.top - ceiling);
  const space = (lift: number) => stage.bottom - BOTTOM_PX - (board.bottom - lift) - GAP_PX;
  const forFull = Math.max(0, FULL_BAR_PX - space(0));
  if (forFull <= maxLift) return { lift: Math.round(forFull), room: Math.floor(space(forFull)), collapsed: false };
  if (space(maxLift) >= MIN_FULL_BAR_PX) return { lift: Math.round(maxLift), room: Math.floor(space(maxLift)), collapsed: false };
  const forLine = Math.min(maxLift, Math.max(0, LINE_BAR_PX - space(0)));
  return { lift: Math.round(forLine), room: Math.floor(space(forLine)), collapsed: true };
}

// The caption's box spans the stage; its visible words are what the board must not cover, so this is where they end.
function captionExtent(caption: HTMLElement | null): { bottom: number; right: number } | null {
  if (caption === null) return null;
  const walker = document.createTreeWalker(caption, NodeFilter.SHOW_TEXT);
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || node.textContent?.trim() === "" || getComputedStyle(parent).visibility !== "visible") continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }
  }
  return Number.isFinite(right) ? { bottom, right } : null;
}

const CLOSED: BarFit = { lift: 0, room: FULL_BAR_PX, collapsed: false };

/** Measures the stage while the bar is open and keeps the fit as the window or the board changes. */
export function useBarFit(stage: RefObject<HTMLElement | null>, open: boolean, boardKey: string): BarFit {
  const [fit, setFit] = useState<BarFit>(CLOSED);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!open || element === null) {
      element?.style.removeProperty("--floor-rest");
      setFit(CLOSED);
      return;
    }
    // The strip under the bar grows while a proposal previews (it marks the layers it touches). Unseen under the bar, it must not take
    // height from the board's row, so its row keeps the height it had when the bar opened.
    const floor = element.querySelector<HTMLElement>(":scope > .stage-floor");
    if (floor !== null) element.style.setProperty("--floor-rest", `${floor.offsetHeight}px`);
    const measure = () => {
      const keyboard = element.querySelector<HTMLElement>(".keyboard-well > .keyboard");
      const well = keyboard?.parentElement ?? null;
      if (keyboard === null || well === null) return;
      const s = element.getBoundingClientRect();
      // Offsets ignore transforms, so this is where the board rests whatever lift is applied or animating.
      const top = s.top + well.offsetTop + keyboard.offsetTop - well.scrollTop;
      const left = s.left + well.offsetLeft + keyboard.offsetLeft - well.scrollLeft;
      const c = captionExtent(element.querySelector<HTMLElement>(".caption"));
      const next = fitBar({
        stage: { top: s.top, bottom: s.bottom },
        board: { top, bottom: top + keyboard.offsetHeight, left },
        caption: c === null ? null : { bottom: c.bottom, right: c.right },
      });
      setFit((current) => (current.lift === next.lift && current.room === next.room && current.collapsed === next.collapsed ? current : next));
    };
    measure();
    // The caption steps back with a short transition when the bar opens; measure again once it has settled.
    const settled = window.setTimeout(measure, 380);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const keyboard = element.querySelector(".keyboard-well > .keyboard");
    if (keyboard !== null) observer.observe(keyboard);
    return () => {
      window.clearTimeout(settled);
      observer.disconnect();
    };
  }, [stage, open, boardKey]);
  return fit;
}
