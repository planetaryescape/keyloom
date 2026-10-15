// Adapted from nickcoutsos/keymap-editor app/src/key-units.js @ e7946792 (MIT)
// Rotation about an origin follows keymap-layout-tools lib/geometry.js @ 16182b20 (MIT).
import type { BoardDefinition, GeometryKey } from "../../boards/schema.ts";

export interface Point {
  x: number;
  y: number;
}

// Extent of every rotated key, in board units. Origin is the top-left of the canvas.
export interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

// A key's unrotated box in canvas units, plus the rotation to apply about a point
// measured from that box's top-left (CSS rotate() around transform-origin).
export interface KeyRect {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
  originX: number;
  originY: number;
}

// Corners of the key after rotation about (rx, ry). Clockwise on screen for positive r,
// matching CSS rotate() in a y-down coordinate system.
export function rotatedCorners(key: GeometryKey): Point[] {
  const angle = (key.r * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: Point[] = [
    { x: key.x, y: key.y },
    { x: key.x + key.w, y: key.y },
    { x: key.x + key.w, y: key.y + key.h },
    { x: key.x, y: key.y + key.h },
  ];
  return corners.map((p) => {
    const dx = p.x - key.rx;
    const dy = p.y - key.ry;
    return { x: key.rx + dx * cos - dy * sin, y: key.ry + dy * cos + dx * sin };
  });
}

// The middle of the key as drawn, in canvas units: where an arrow from one key to another starts and ends.
export function keyCenter(key: GeometryKey, bounds: Bounds): Point {
  const corners = rotatedCorners(key);
  return {
    x: corners.reduce((sum, p) => sum + p.x, 0) / corners.length - bounds.minX,
    y: corners.reduce((sum, p) => sum + p.y, 0) / corners.length - bounds.minY,
  };
}

// The canvas is the union of every rotated key, so thumb clusters and tilted columns
// fit without special cases.
export function boardBounds(keys: readonly GeometryKey[]): Bounds {
  const points = keys.flatMap(rotatedCorners);
  if (points.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    minX,
    minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

// The unrotated box is positioned relative to the canvas. Its rotation origin is kept
// relative to the box so the CSS transform matches the polygon math above.
export function keyRect(key: GeometryKey, bounds: Bounds): KeyRect {
  return {
    left: key.x - bounds.minX,
    top: key.y - bounds.minY,
    width: key.w,
    height: key.h,
    rotate: key.r,
    originX: key.rx - key.x,
    originY: key.ry - key.y,
  };
}

// Display-only rotation from the board definition (D-045): the Moonlander's tilted thumb
// cluster is the case in point. It changes how keys are drawn, never their binding order.
// Positions outside the geometry are an error, not a silent skip, because they mean the
// board definition and geometry disagree.
export function applyDisplayRotation(
  keys: readonly GeometryKey[],
  display: BoardDefinition["display"],
): GeometryKey[] {
  const out = keys.map((key) => ({ ...key }));
  for (const rotation of display?.rotate ?? []) {
    for (const position of rotation.positions) {
      const key = out[position];
      if (key === undefined) {
        throw new Error(`display rotation refers to key ${position}, but the board has ${keys.length} keys`);
      }
      key.r = rotation.r;
      key.rx = rotation.rx;
      key.ry = rotation.ry;
    }
  }
  for (const move of display?.shift ?? []) {
    for (const position of move.positions) {
      const key = out[position];
      if (key === undefined) {
        throw new Error(`display shift refers to key ${position}, but the board has ${keys.length} keys`);
      }
      key.x += move.dx;
      key.rx += move.dx;
    }
  }
  return out;
}

/**
 * The two hands' trays, each its keys' bounds grown by `pad`. When the halves sit so close that the
 * grown trays would overlap (the Corne's tilted inner thumbs nearly meet), each stops `gap / 2` short
 * of the midpoint between the two hands' keys instead.
 */
export const MAX_SPLIT_OVERLAP = 0.5;

export const growBounds = (b: Bounds, pad: number): Bounds => ({ minX: b.minX - pad, minY: b.minY - pad, width: b.width + 2 * pad, height: b.height + 2 * pad });

export function handTrays(left: Bounds, right: Bounds, pad: number, gap: number): [Bounds, Bounds] {
  const l = growBounds(left, pad);
  const r = growBounds(right, pad);
  const leftKeysEnd = left.minX + left.width;
  // Tilted thumbs can overlap a hair in x without touching (the Corne's do, by 0.007 keys); halves that
  // truly interleave are left alone, since no vertical split separates them.
  if (l.minX + l.width + gap <= r.minX || leftKeysEnd - right.minX > MAX_SPLIT_OVERLAP) return [l, r];
  const split = (leftKeysEnd + right.minX) / 2;
  const lEnd = split - gap / 2;
  const rStart = split + gap / 2;
  return [
    { ...l, width: lEnd - l.minX },
    { ...r, minX: rStart, width: r.minX + r.width - rStart },
  ];
}
