import { useLayoutEffect, useState } from "react";

/** The top bar's height on a phone (`sheet.ts`): the pill never rises over it. */
const HEADER_PX = 54;
const GAP_PX = 8;

/**
 * How far above the screen's bottom edge the agent's pill sits on a phone (R11-11), or null for its own corner. The lab's card and the
 * proposals, review, lab and new-keyboard sheets float at the stage's foot with a height that follows their content, so the pill is
 * measured above whichever is up, and moves when it grows. `pillHeight` keeps it under the top bar when the panel is that tall.
 * `watch` changes when a panel may have opened or closed.
 */
export function usePanelLift(active: boolean, selector: string, watch: string, pillHeight = 64): number | null {
  const [lift, setLift] = useState<number | null>(null);
  useLayoutEffect(() => {
    const panel = active ? document.querySelector(selector) : null;
    if (panel === null) {
      setLift(null);
      return;
    }
    const measure = () => {
      const above = window.innerHeight - panel.getBoundingClientRect().top + GAP_PX;
      setLift(Math.min(above, window.innerHeight - HEADER_PX - GAP_PX - pillHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active, selector, watch, pillHeight]);
  return lift;
}
