// The layout the dev servers open: the synchronized Oryx layout (test/fixtures/oryx/synchronized), read by
// keyloom's own importer, on the live board definition and geometry the app serves. Nothing here copies
// boards/, so a board change shows up the next time a dev server starts. The fake backend keeps the layout
// in memory; no database, Docker or keyboard is involved.
import { fileURLToPath } from "node:url";
import type { LayoutDetail } from "../../src/api/http.ts";
import { showBoard } from "../../src/app/boards.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";

const ORYX_SAMPLE = fileURLToPath(new URL("../fixtures/oryx/synchronized", import.meta.url));

export async function devSample(): Promise<LayoutDetail> {
  const board = showBoard("zsa/moonlander");
  const { layout } = await importOryxSource(ORYX_SAMPLE, board.definition);
  return {
    revision: {
      id: "rev_dev_sample",
      parentId: null,
      origin: "import",
      summary: "Dev sample: the synchronized Oryx layout",
      createdAt: Date.UTC(2026, 9, 28),
      undoable: false,
    },
    document: layout,
    board: board.definition,
    geometry: board.geometry,
    upgrade: null,
  };
}
