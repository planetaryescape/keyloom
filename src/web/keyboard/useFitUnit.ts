import { useEffect, useRef, useState, type RefObject } from "react";

// Smallest and largest key size in px. Below the minimum the board scrolls inside its well
// rather than shrinking legends past what a phone can show.
const MIN_UNIT = 46;
const MAX_UNIT = 84;

interface FitInput {
  /** Board size in key units, padding included. */
  width: number;
  height: number;
  /** Vertical space the rest of the page needs, so the inspector stays above the fold. */
  reservedHeight: number;
}

// Scales the board to its container's width, never taller than the window leaves room for,
// keeping its proportions. Returns px per key unit; layout and type derive from it.
export function useFitUnit({ width, height, reservedHeight }: FitInput): {
  ref: RefObject<HTMLDivElement | null>;
  unit: number;
  /** True when the board is wider than its container and scrolls sideways. */
  overflowing: boolean;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState({ width: 0, viewportHeight: 0 });

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () =>
      setAvailable({ width: element.clientWidth - paddingX(element), viewportHeight: window.innerHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const byWidth = width > 0 ? available.width / width : MAX_UNIT;
  const byHeight = height > 0 ? (available.viewportHeight - reservedHeight) / height : MAX_UNIT;
  const unit = Math.max(MIN_UNIT, Math.min(MAX_UNIT, byWidth, byHeight));
  const fitted = Math.floor(unit);
  return { ref, unit: fitted, overflowing: width * fitted > available.width + 1 };
}

function paddingX(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
}
