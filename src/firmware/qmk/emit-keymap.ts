// keymaps[]: one LAYOUT_*(...) per layer, laid out in the board's physical rows.
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { type EmitContext, bindingToC } from "./emit-binding.ts";
import { GenerateError } from "./generate-error.ts";

/** Positions grouped by the board's named rows, when those rows partition 0..keyCount-1 in order; otherwise `null`. */
function rowGroups(board: BoardDefinition): number[][] | null {
  const rows = Object.values(board.rows).filter((r) => r.length > 0).map((r) => [...r].sort((a, b) => a - b));
  rows.sort((a, b) => (a[0] as number) - (b[0] as number));
  const flat = rows.flat();
  return flat.length === board.keyCount && flat.every((p, i) => p === i) ? rows : null;
}

// A trailing backslash would continue a // comment onto the next line.
const oneLine = (s: string): string => s.replace(/\\/g, "/").replace(/\s+/g, " ").trim();

export function renderKeymaps(layout: Layout, board: BoardDefinition, layoutMacro: string, ctx: EmitContext): string {
  const groups = rowGroups(board) ?? [Array.from({ length: board.keyCount }, (_, i) => i)];
  const last = board.keyCount - 1;
  const blocks = layout.layers.map((layer, li) => {
    if (layer.bindings.length !== board.keyCount) {
      throw new GenerateError(`layer ${layer.id} has ${layer.bindings.length} bindings, but ${board.id} has ${board.keyCount} keys`);
    }
    const cells = layer.bindings.map((b, position) => {
      try {
        return bindingToC(b, ctx);
      } catch (err) {
        if (err instanceof GenerateError) throw new GenerateError(`layer ${layer.id}, position ${position}: ${err.message}`);
        throw err;
      }
    });
    const width = Math.max(...cells.map((c) => c.length)) + 1;
    const lines = groups.map((positions) =>
      `    ${positions.map((p) => (p === last ? (cells[p] as string) : `${cells[p]},`.padEnd(width))).join(" ")}`.trimEnd(),
    );
    return [`  // ${layer.id}: ${oneLine(layer.name)}`, `  [${li}] = ${layoutMacro}(`, ...lines, "  ),"].join("\n");
  });
  return `const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {\n${blocks.join("\n")}\n};`;
}
