// The layers of the keymap node, laid out in the board's physical rows (06).
import type { BoardDefinition, Geometry } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { type EmitContext, bindingToDts, labelOf } from "./emit-binding.ts";
import { GenerateError } from "./generate-error.ts";
import { nodeNameOf } from "./slug.ts";

const quote = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

/**
 * Positions grouped into the keyboard's rows, from each key's y in the geometry. The groups must be
 * runs of consecutive positions in order, which is what binding order means for a row-major board;
 * anything else falls back to fixed-width lines rather than guessing.
 */
export function rowsOf(geometry: Geometry | undefined, keyCount: number): number[][] {
  const byRow = new Map<number, number[]>();
  geometry?.keys.forEach((k, p) => byRow.set(Math.floor(k.y), [...(byRow.get(Math.floor(k.y)) ?? []), p]));
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, ps]) => ps);
  const flat = rows.flat();
  if (geometry && flat.length === keyCount && flat.every((p, i) => p === i)) return rows;
  // Raised or tilted thumb keys (the Corne's sit at y 2.83 beside a row at 2.24) break grouping by height.
  // Position order is row-major, so a new row starts wherever x steps back to the left.
  if (geometry && geometry.keys.length === keyCount && keyCount > 0) {
    const wrapped: number[][] = [[0]];
    for (let p = 1; p < keyCount; p++) {
      if ((geometry.keys[p] as { x: number }).x < (geometry.keys[p - 1] as { x: number }).x) wrapped.push([]);
      (wrapped[wrapped.length - 1] as number[]).push(p);
    }
    if (wrapped.length > 1) return wrapped;
  }
  return Array.from({ length: Math.ceil(keyCount / 10) }, (_, r) => Array.from({ length: Math.min(10, keyCount - r * 10) }, (_, i) => r * 10 + i));
}

export function renderLayers(layout: Layout, board: BoardDefinition, geometry: Geometry | undefined, ctx: EmitContext, sensorBindings: ReadonlyMap<string, string[]>): string[] {
  const rows = rowsOf(geometry, board.keyCount);
  const left = new Set(board.hands.left);
  const nodeNames = new Set<string>();
  const out: string[] = [];
  layout.layers.forEach((layer, li) => {
    const sensors = sensorBindings.get(layer.id);
    if (layer.bindings.length !== board.keyCount) {
      throw new GenerateError(`layer ${layer.id} has ${layer.bindings.length} bindings, but ${board.id} has ${board.keyCount} keys`);
    }
    const name = nodeNameOf(layer.id);
    if (nodeNames.has(labelOf(name))) throw new GenerateError(`two layers are written as "${name}"`);
    nodeNames.add(labelOf(name));
    const cells = layer.bindings.map((b, position) => {
      try {
        return bindingToDts(b, ctx);
      } catch (err) {
        if (err instanceof GenerateError) throw new GenerateError(`layer ${layer.id}, position ${position}: ${err.message}`);
        throw err;
      }
    });
    // Each hand's keys line up from its own outer edge, so the thumb keys of one row fall under those of the next.
    const column = (row: number[], i: number): string => {
      const p = row[i] as number;
      const side = left.has(p) ? "L" : "R";
      const sameSide = row.filter((q) => left.has(q) === left.has(p));
      const k = row.indexOf(p) - row.indexOf(sameSide[0] as number);
      return side === "L" ? `L${k}` : `R${sameSide.length - 1 - k}`;
    };
    const width = new Map<string, number>();
    for (const row of rows) row.forEach((p, i) => width.set(column(row, i), Math.max(width.get(column(row, i)) ?? 0, (cells[p] as string).length)));
    const lines = rows.map((row) =>
      row
        .map((p, i) => {
          const prev = row[i - 1];
          const gap = prev === undefined ? "" : left.has(prev) !== left.has(p) ? "    " : " ";
          return `${gap}${(cells[p] as string).padEnd(width.get(column(row, i)) as number)}`;
        })
        .join("")
        .trimEnd(),
    );
    out.push(
      `${name} {`,
      `    // layer ${li}`,
      ...(sensors?.length ? [`    sensor-bindings = <${sensors.join(" ")}>;`] : []),
      `    display-name = ${quote(layer.name)};`,
      "    bindings = <",
      ...lines.map((l) => `        ${l}`),
      "    >;",
      "};",
      "",
    );
  });
  out.pop();
  return out;
}
