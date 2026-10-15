import { useId } from "react";
import type { GeometryKey } from "../../boards/schema.ts";
import { type Bounds, keyCenter } from "./geometry.ts";

interface Props {
  keys: readonly GeometryKey[];
  canvas: Bounds;
  unit: number;
  arrows: ReadonlyArray<{ from: number; to: number }>;
}

// How far an arrow stops short of each key's middle, in key units, so it doesn't cover the legend it points at.
// Short arrows between neighbours get less, or nothing would be left to draw.
const INSET = 0.42;
const INSET_SHARE = 0.3;

// How far the curve bows to the left of its direction of travel, as a share of the arrow's length.
// Two functions that swap places then arc on opposite sides, and a long move over a short one
// bows further, so arrows along one row stay apart instead of drawing one double-headed line.
const BOW = 0.22;

// Where a hovered proposal sends the functions it pushes out of the way. Drawn over the caps and
// ignored by the pointer, so the board stays usable under it. A pale halo keeps the line legible
// across both dark and light caps.
export function MoveArrows({ keys, canvas, unit, arrows }: Props) {
  const marker = useId();
  if (arrows.length === 0) return null;
  return (
    <svg className="move-arrows" width={canvas.width * unit} height={canvas.height * unit} aria-hidden="true">
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {arrows.map(({ from, to }) => {
        const a = keys[from];
        const b = keys[to];
        if (a === undefined || b === undefined) return null;
        const start = keyCenter(a, canvas);
        const end = keyCenter(b, canvas);
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const shorten = Math.min(INSET, length * INSET_SHARE) / length;
        const x1 = (start.x + (end.x - start.x) * shorten) * unit;
        const y1 = (start.y + (end.y - start.y) * shorten) * unit;
        const x2 = (end.x - (end.x - start.x) * shorten) * unit;
        const y2 = (end.y - (end.y - start.y) * shorten) * unit;
        const bow = BOW * Math.hypot(x2 - x1, y2 - y1);
        const nx = (y2 - y1) / Math.hypot(x2 - x1, y2 - y1);
        const ny = -(x2 - x1) / Math.hypot(x2 - x1, y2 - y1);
        const d = `M${x1} ${y1} Q${(x1 + x2) / 2 + nx * bow} ${(y1 + y2) / 2 + ny * bow} ${x2} ${y2}`;
        return (
          <g key={`${from}>${to}`}>
            <path d={d} className="move-arrow-halo" />
            <path d={d} className="move-arrow" markerEnd={`url(#${marker})`} />
          </g>
        );
      })}
    </svg>
  );
}
