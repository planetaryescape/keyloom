// Text renderings the CLI prints and the agent will reuse (10#output-contract).
import { renderCells, renderLayout } from "../layout/render-grid.ts";
import type { Layer } from "../layout/schema.ts";
import type { LayoutView } from "./layouts.ts";
import { NotFoundError } from "./errors.ts";
import type { Board } from "./boards.ts";

/** The layers to show: all of them, or the one `layer` names by ID, index or name. */
export function selectLayers(view: LayoutView, layer?: string): Layer[] {
  const { layers } = view.document;
  if (layer === undefined) return layers;
  const match = layers.find((l, i) => l.id === layer || l.name === layer || String(i) === layer);
  if (!match) throw new NotFoundError(`layout ${view.layout.name} has no layer "${layer}" (layers: ${layers.map((l) => l.id).join(", ")})`);
  return [match];
}

/** Every layer as a grid placed by the board's physical rows, or one layer when `layer` is given. */
export function renderLayoutText(view: LayoutView, layer?: string): string {
  const [only] = layer === undefined ? [] : selectLayers(view, layer);
  return renderLayout(view.board.geometry.keys, view.document, only ? { onlyLayerId: only.id } : {});
}

/** Position numbers laid out like the board, so a contributor can see which number is which key. */
export function renderPositionGrid(board: Board): string {
  const labels = board.geometry.keys.map((_, i) => String(i));
  return renderCells(board.geometry.keys, labels).join("\n");
}
