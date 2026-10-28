import { useEffect, useRef, useState, type RefObject } from "react";

// Smallest and largest key size in px. Below the minimum the board scrolls inside its stage
// rather than shrinking caps past what a fingertip or a legend can use (18: caps are 44 px or more).
// Above the maximum a small board (a Corne, a laptop) would fill the stage with oversized caps; every board stays about the size of a
// real one on a laptop screen (D-271).
// 44 px is a fingertip; a mouse can hit smaller keys, so a short window with a mouse lets the board shrink further before it has to
// scroll (hotfix v0.22.1: BK's 1280x577 window).
const MIN_UNIT_TOUCH = 44;
const MIN_UNIT_MOUSE = 34;
const MAX_UNIT = 58;

/** The smallest key the board is drawn at for this pointer: a fingertip's 44 px, or 34 px with a mouse. */
export function minUnit(): number {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? MIN_UNIT_TOUCH : MIN_UNIT_MOUSE;
}

interface FitInput {
  /** Board size in key units, margins included. */
  width: number;
  height: number;
}

// Sizes the board to the stage it sits in, by width and by height, keeping its proportions
// (18#the-board-stays-in-view). The stage's size comes from the page layout and never from the
// board or the panel beside it, so opening a panel cannot change the unit. Returns px per key unit.
export function useFitUnit({ width, height }: FitInput): {
  ref: RefObject<HTMLDivElement | null>;
  unit: number;
  /** True when the board is wider or taller than the stage, so the stage scrolls it. */
  overflowing: boolean;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const padY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      setAvailable({ width: element.clientWidth - padX, height: element.clientHeight - padY });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, ...fitUnit({ width, height }, available, minUnit()) };
}

/** px per key unit for a board of `board` key units in a stage of `available` px, never under `min`; pure, for the stage-fit test. */
export function fitUnit(board: FitInput, available: { width: number; height: number }, min: number): { unit: number; overflowing: boolean } {
  const byWidth = board.width > 0 ? available.width / board.width : MAX_UNIT;
  const byHeight = board.height > 0 && available.height > 0 ? available.height / board.height : MAX_UNIT;
  const unit = Math.floor(Math.max(min, Math.min(MAX_UNIT, byWidth, byHeight)));
  return { unit, overflowing: board.width * unit > available.width + 1 || board.height * unit > available.height + 1 };
}

export const MIN_UNIT = { touch: MIN_UNIT_TOUCH, mouse: MIN_UNIT_MOUSE } as const;
