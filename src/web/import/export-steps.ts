import type { BoardChoice } from "../../api/http.ts";

export type ExportGuide = { tool: string; steps: string; accepts: string; extensions: readonly string[] };

// Which file each importer reads and where it comes from. The importers' ids are the boards' own (boards/*/board.json),
// so a new board with a known importer needs no change here.
const GUIDES: Record<string, ExportGuide> = {
  "oryx-source": {
    tool: "Oryx",
    steps: "Open your layout in Oryx, choose Download source, and drop the .zip it gives you.",
    accepts: ".zip",
    extensions: [".zip"],
  },
  "zmk-layout-editor-keymap": {
    tool: "the Layout Editor",
    steps: "Open your layout in the MoErgo Layout Editor, choose Export, and drop the .keymap file.",
    accepts: ".keymap",
    extensions: [".keymap"],
  },
  "zmk-keymap": {
    tool: "your ZMK config",
    steps: "Drop the .keymap file from your zmk-config repository, such as config/corne.keymap.",
    accepts: ".keymap",
    extensions: [".keymap"],
  },
  "karabiner-json": {
    tool: "Karabiner-Elements",
    steps: "Drop a copy of ~/.config/karabiner/karabiner.json. keyloom only reads it: your rules stay in the file, and keyloom shows the edit that stops Karabiner grabbing the built-in keyboard.",
    accepts: ".json",
    extensions: [".json"],
  },
  "qmk-keymap": {
    tool: "your QMK keymap",
    steps: "Drop your keymap's keymap.json, or zip the keymap folder with keymap.c in it and drop the .zip.",
    accepts: ".zip or keymap.json",
    extensions: [".zip", ".json"],
  },
};

const FALLBACK: ExportGuide = { tool: "your editor", steps: "Drop the file the importer reads.", accepts: ".zip or .keymap", extensions: [".zip", ".keymap"] };

/** The first importer the board lists that has a guide; a board with only unknown importers still gets a card, with a plain fallback. */
export function guideFor(board: BoardChoice): ExportGuide {
  for (const id of board.importers) {
    const guide = GUIDES[id];
    if (guide !== undefined) return guide;
  }
  return FALLBACK;
}

export const importCommand = (board: BoardChoice): string => `keyloom import --board ${board.id} <file>`;

export function acceptsFile(guide: ExportGuide, filename: string): boolean {
  const name = filename.toLowerCase();
  return guide.extensions.some((extension) => name.endsWith(extension));
}
