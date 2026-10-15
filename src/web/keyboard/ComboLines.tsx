import { useLayoutEffect, useRef, useState } from "react";
import type { GeometryKey } from "../../boards/schema.ts";
import { type Rect, placeLabel } from "./combo-labels.ts";
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
// What a label keeps clear of: every printed legend and mark on every cap.
const LEGENDS = ".cap-tap, .cap-hold, .cap-double, .cap-dots, .cap-glyph, .cap-combo, .cap-mark";
const KEEP_CLEAR = 2;

// The text's own box, not its element's: a legend element can be as wide as its cap while the word in it is not. Boxes are
// in the svg's own pixels (what the label's transform uses), and a rotated cap's legend is its axis-aligned bounds.
function legendRect(element: Element, origin: DOMRect): Rect | null {
  const range = document.createRange();
  range.selectNodeContents(element);
  const box = range.getBoundingClientRect();
  const raw = box.width > 0 && box.height > 0 ? box : element.getBoundingClientRect();
  if (raw.width === 0 || raw.height === 0) return null;
  return { x: raw.left - origin.left - KEEP_CLEAR, y: raw.top - origin.top - KEEP_CLEAR, w: raw.width + 2 * KEEP_CLEAR, h: raw.height + 2 * KEEP_CLEAR };
}

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
  const root = useRef<SVGSVGElement>(null);
  const [spots, setSpots] = useState<ReadonlyMap<string, Point>>(new Map());

  const shapes = lines.flatMap((line) => {
    const centres = line.positions.flatMap((position) => {
      const key = keys[position];
      return key === undefined ? [] : [keyCenter(key, canvas)];
    });
    if (centres.length < 2) return [];
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
    // A two-key line is searched along itself; a loop of three or more, along its first side.
    const [first, second] = [ring[0], ring[1]];
    const run = first === undefined || second === undefined ? { x: 1, y: 0, length: unit } : { x: second.x - first.x, y: second.y - first.y, length: Math.hypot(second.x - first.x, second.y - first.y) || unit };
    return [{ line, d, mid: labelPoint(ring), along: { x: run.x / (run.length || 1), y: run.y / (run.length || 1) }, length: ring.length === 2 ? run.length : unit, width: Math.ceil(textEm(line.label) * LABEL_PX) + 12 }];
  });

  // Labels are placed after the caps are laid out, because only the browser knows where the legends are.
  useLayoutEffect(() => {
    const svg = root.current;
    const board = svg?.parentElement;
    if (svg === null || board === null || board === undefined) return;
    const unfade = () => {
      for (const faded of board.querySelectorAll("[data-combo-under]")) faded.removeAttribute("data-combo-under");
    };
    unfade();
    const origin = svg.getBoundingClientRect();
    const elements: Element[] = [];
    const obstacles: Rect[] = [];
    for (const element of board.querySelectorAll(LEGENDS)) {
      const rect = legendRect(element, origin);
      if (rect === null) continue;
      elements.push(element);
      obstacles.push(rect);
    }
    const next = new Map<string, Point>();
    for (const shape of shapes) {
      const placed = placeLabel(shape.mid, shape.along, shape.length, unit, { w: shape.width, h: PILL_H }, obstacles);
      next.set(shape.line.id, placed.at);
      // A spot clear of every legend was not found: the legends under the label fade, so the label is read alone.
      for (const index of placed.covers) elements[index]?.setAttribute("data-combo-under", "true");
      obstacles.push({ x: placed.at.x - shape.width / 2, y: placed.at.y - PILL_H / 2, w: shape.width, h: PILL_H });
    }
    const same = next.size === spots.size && [...next].every(([id, at]) => {
      const was = spots.get(id);
      return was !== undefined && Math.abs(was.x - at.x) < 0.5 && Math.abs(was.y - at.y) < 0.5;
    });
    if (!same) setSpots(next);
    // Hiding the combos or moving a label must not leave a legend faded behind it.
    return unfade;
  });

  if (shapes.length === 0) return null;
  return (
    <svg ref={root} className="combo-lines" width={canvas.width * unit} height={canvas.height * unit} aria-hidden={false} role="group" aria-label="Combos">
      {shapes.map(({ line, d, mid, width }) => {
        const at = spots.get(line.id) ?? mid;
        const away = Math.hypot(at.x - mid.x, at.y - mid.y);
        const state = line.editing === true ? "editing" : hovered === line.id ? "hover" : "rest";
        return (
          <g key={line.id} className="combo-line" data-state={state}>
            <path d={d} className="combo-halo" />
            <path d={d} className="combo-stroke" />
            {away > PILL_H / 2 ? <path d={`M${mid.x} ${mid.y} L${at.x} ${at.y}`} className="combo-leader" /> : null}
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
              transform={`translate(${at.x} ${at.y})`}
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
