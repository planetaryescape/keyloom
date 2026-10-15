import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface KeyDrag {
  from: number;
  x: number;
  y: number;
  /** The key under the pointer, if any other than the one being dragged. */
  over: number | null;
  /** Option is held: dropping copies instead of swapping. */
  copy: boolean;
}

interface Options {
  enabled: boolean;
  onDrop: (from: number, to: number, copy: boolean) => void;
}

// A mouse starts a drag after a few pixels. A finger starts one after a long press, so a swipe or a
// tap is never mistaken for it (16#moving-and-copying-keys); the caps set touch-action: none so the
// browser doesn't scroll the page out from under the drag.
const MOUSE_SLOP_PX = 5;
const TOUCH_SLOP_PX = 10;
const LONG_PRESS_MS = 380;

const keyUnder = (x: number, y: number): number | null => {
  const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-key-index]");
  const index = hit === null || hit === undefined ? Number.NaN : Number(hit.dataset.keyIndex);
  return Number.isInteger(index) ? index : null;
};

export function useKeyDrag({ enabled, onDrop }: Options) {
  const [drag, setDrag] = useState<KeyDrag | null>(null);
  const justDragged = useRef(false);
  const cancel = useRef<(() => void) | null>(null);
  const latest = useRef(onDrop);
  latest.current = onDrop;

  // A drag that outlives the board (the panel closed, the layer changed) must not drop on a stale index.
  useEffect(() => () => cancel.current?.(), []);
  useEffect(() => {
    if (!enabled) cancel.current?.();
  }, [enabled]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent, from: number) => {
      if (!enabled || event.button !== 0) return;
      cancel.current?.();
      const touch = event.pointerType === "touch";
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      let timer = 0;

      const stop = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", abort);
        window.removeEventListener("keydown", key, true);
        window.removeEventListener("contextmenu", noMenu, true);
        cancel.current = null;
        setDrag(null);
      };
      const begin = (x: number, y: number, copy: boolean) => {
        active = true;
        setDrag({ from, x, y, over: null, copy });
      };
      const move = (e: PointerEvent) => {
        if (!active) {
          const distance = Math.hypot(e.clientX - startX, e.clientY - startY);
          // A finger that moves before the long press is a swipe or a scroll, not a drag.
          if (touch && distance > TOUCH_SLOP_PX) stop();
          else if (!touch && distance > MOUSE_SLOP_PX) begin(e.clientX, e.clientY, e.altKey);
          return;
        }
        const over = keyUnder(e.clientX, e.clientY);
        setDrag({ from, x: e.clientX, y: e.clientY, over: over === from ? null : over, copy: e.altKey });
      };
      const up = (e: PointerEvent) => {
        const wasActive = active;
        const over = wasActive ? keyUnder(e.clientX, e.clientY) : null;
        stop();
        if (!wasActive) return;
        // The click that follows a drag's pointer-up must not open the key it ended on.
        justDragged.current = true;
        window.setTimeout(() => {
          justDragged.current = false;
        }, 60);
        if (over !== null && over !== from) latest.current(from, over, e.altKey);
      };
      const abort = () => stop();
      const key = (e: KeyboardEvent) => {
        if (e.key === "Escape" && active) {
          e.stopPropagation();
          stop();
        }
      };
      const noMenu = (e: Event) => {
        if (active || touch) e.preventDefault();
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", abort);
      window.addEventListener("keydown", key, true);
      window.addEventListener("contextmenu", noMenu, true);
      cancel.current = stop;
      if (touch) timer = window.setTimeout(() => begin(startX, startY, false), LONG_PRESS_MS);
    },
    [enabled],
  );

  return { drag, onPointerDown, wasDrag: () => justDragged.current };
}
