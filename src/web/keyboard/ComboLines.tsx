import type { GeometryKey } from "../../boards/schema.ts";
import { type Bounds, type Point, keyCenter } from "./geometry.ts";
import { textEm } from "./fit.ts";

export interface ComboLine {
  id: string;
  positions: readonly number[];
  /** The combo's output in a word or two, printed on the line. */
  label: string;
  /** The words a screen reader gets for the line. */
  name: string;
  /** The combo being edited, drawn bolder than the rest. */
  editing?: boolean;
}

interface Props {
  keys: readonly GeometryKey[];
  canvas: Bounds;
  unit: number;
  lines: readonly ComboLine[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}

// How far a side stops short of each key's middle, in key units, and at most this share of the side's length.
const INSET = 0.3;
const INSET_SHARE = 0.3;
const LABEL_PX = 11;
const PILL_H = 17;

// Keys of one combo joined in order around their middle, so three or four keys read as a loop and two as a line.
// Drawn from the keys' rotated centres, so the Moonlander's tilted and the Glove80's fanned thumb keys are joined where they are drawn.
export function aroundCentre(points: readonly Point[]): Point[] {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

/** Where a combo's label sits: the middle of a two-key line, the middle of a larger shape. */
export function labelPoint(points: readonly Point[]): Point {
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
}

// "Show combos": a thin line between each combo's keys with its output as a small label. The svg
// ignores the pointer except on the lines and labels, so the caps under it stay clickable.
export function ComboLines({ keys, canvas, unit, lines, hovered, onHover, onOpen }: Props) {
  if (lines.length === 0) return null;
  return (
    <svg className="combo-lines" width={canvas.width * unit} height={canvas.height * unit} aria-hidden={false} role="group" aria-label="Combos">
      {lines.map((line) => {
        const centres = line.positions.flatMap((position) => {
          const key = keys[position];
          return key === undefined ? [] : [keyCenter(key, canvas)];
        });
        if (centres.length < 2) return null;
        const ring = aroundCentre(centres).map((p) => ({ x: p.x * unit, y: p.y * unit }));
        // Each side stops short of the keys' middles, so a line doesn't strike through the legends it joins (as MoveArrows does).
        const sides = ring.length === 2 ? [[ring[0], ring[1]]] : ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
        const d = sides
          .map(([a, b]) => {
            if (a === undefined || b === undefined) return "";
            const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const cut = Math.min(INSET * unit, length * INSET_SHARE) / length;
            return `M${a.x + (b.x - a.x) * cut} ${a.y + (b.y - a.y) * cut} L${b.x - (b.x - a.x) * cut} ${b.y - (b.y - a.y) * cut}`;
          })
          .join(" ");
        const mid = labelPoint(ring);
        const width = Math.ceil(textEm(line.label) * LABEL_PX) + 12;
        const state = line.editing === true ? "editing" : hovered === line.id ? "hover" : "rest";
        return (
          <g key={line.id} className="combo-line" data-state={state}>
            <path d={d} className="combo-halo" />
            <path d={d} className="combo-stroke" />
            <path
              d={d}
              className="combo-hit"
              onPointerEnter={() => onHover(line.id)}
              onPointerLeave={() => onHover(null)}
              onClick={() => onOpen(line.id)}
            />
            <g
              className="combo-label"
              role="button"
              tabIndex={0}
              aria-label={`${line.name}. Edit this combo`}
              transform={`translate(${mid.x} ${mid.y})`}
              onPointerEnter={() => onHover(line.id)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(line.id)}
              onBlur={() => onHover(null)}
              onClick={() => onOpen(line.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpen(line.id);
                }
              }}
            >
              <rect x={-width / 2} y={-PILL_H / 2} width={width} height={PILL_H} rx={PILL_H / 2} />
              <text textAnchor="middle" dominantBaseline="central" fontSize={LABEL_PX}>{line.label}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
