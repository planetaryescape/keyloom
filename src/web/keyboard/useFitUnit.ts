import { useEffect, useRef, useState, type RefObject } from "react";

// Smallest and largest key size in px. Below the minimum the board scrolls inside its stage
// rather than shrinking caps past what a fingertip or a legend can use (18: caps are 44 px or more).
// Above the maximum a small board (a Corne, a laptop) would fill the stage with oversized caps; every board stays about the size of a
// real one on a laptop screen (D-271).
const MIN_UNIT = 44;
const MAX_UNIT = 58;

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
  /** True when the board is wider than the stage and scrolls sideways. */
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

  const byWidth = width > 0 ? available.width / width : MAX_UNIT;
  const byHeight = height > 0 && available.height > 0 ? available.height / height : MAX_UNIT;
  const unit = Math.max(MIN_UNIT, Math.min(MAX_UNIT, byWidth, byHeight));
  const fitted = Math.floor(unit);
  return { ref, unit: fitted, overflowing: width * fitted > available.width + 1 };
}
