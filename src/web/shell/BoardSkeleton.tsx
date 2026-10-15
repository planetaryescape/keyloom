import { useMemo } from "react";
import { boardBounds, keyRect, type Bounds } from "../keyboard/geometry.ts";
import { MARGIN, keyStyle } from "../keyboard/Keyboard.tsx";
import { useFitUnit } from "../keyboard/useFitUnit.ts";
import { shapeFor } from "./shape.ts";
import { PHONE, useMediaQuery } from "./useMediaQuery.ts";

// What the layout page shows while it loads (18#states): the toolbar, the board and the side panel as quiet blocks, so the
// page keeps its shape and nothing jumps when the layout arrives. Spinners are only for buttons.
export function BoardSkeleton({ boardId, label }: { boardId: string | null; label: string }) {
  const phone = useMediaQuery(PHONE);
  const shape = useMemo(() => shapeFor(boardId), [boardId]);
  // A phone shows one hand, so the skeleton doesn't promise a board wider than the screen.
  const keys = useMemo(() => (phone ? shape.keys.filter((_, index) => shape.left.includes(index)) : shape.keys), [shape, phone]);
  const bounds = boardBounds(keys);
  const canvas: Bounds = { minX: bounds.minX - MARGIN, minY: bounds.minY - MARGIN, width: bounds.width + 2 * MARGIN, height: bounds.height + 2 * MARGIN };
  const { ref, unit } = useFitUnit({ width: canvas.width, height: canvas.height });
  return (
    <div className="workspace skeleton" role="status" aria-busy="true" aria-label={label}>
      <div className="toolbar" aria-hidden="true">
        <div className="skeleton-tabs">
          {[0, 1, 2, 3].map((n) => <span key={n} className="skeleton-block skeleton-tab" />)}
        </div>
      </div>
      <div className="workbench">
        <section className="stage" aria-hidden="true">
          <div ref={ref} className="keyboard-well">
            <div className="keyboard" style={{ width: canvas.width * unit, height: canvas.height * unit }}>
              {keys.map((key, index) => (
                <span key={index} className="skeleton-block skeleton-cap" style={keyStyle(keyRect(key, canvas), unit)} />
              ))}
            </div>
          </div>
        </section>
        <aside className="side" aria-hidden="true">
          <div className="skeleton-lines">
            <span className="skeleton-block skeleton-line" />
            <span className="skeleton-block skeleton-line" />
            <span className="skeleton-block skeleton-line" />
          </div>
        </aside>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
