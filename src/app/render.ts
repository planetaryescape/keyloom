// Text renderings the CLI prints and the agent will reuse (10#output-contract).
import { renderLayout } from "../layout/render-grid.ts";
import { renderCells } from "../layout/render-grid.ts";
import type { LayoutView } from "./layouts.ts";
import { NotFoundError } from "./errors.ts";
import type { Board } from "./boards.ts";

/** Every layer as a grid placed by the board's physical rows, or one layer when `layer` is an ID, index or name. */
export function renderLayoutText(view: LayoutView, layer?: string): string {
  const { layers } = view.document;
  let onlyLayerId: string | undefined;
  if (layer !== undefined) {
    const match = layers.find((l, i) => l.id === layer || l.name === layer || String(i) === layer);
    if (!match) throw new NotFoundError(`layout ${view.layout.name} has no layer "${layer}" (layers: ${layers.map((l) => l.id).join(", ")})`);
    onlyLayerId = match.id;
  }
  return renderLayout(view.board.geometry.keys, view.document, onlyLayerId === undefined ? {} : { onlyLayerId });
}

/** Position numbers laid out like the board, so a contributor can see which number is which key. */
export function renderPositionGrid(board: Board): string {
  const labels = board.geometry.keys.map((_, i) => String(i));
  return renderCells(board.geometry.keys, labels).join("\n");
}
