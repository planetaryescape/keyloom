import type { BoardChoice } from "../../api/http.ts";
import type { ReviewActivity } from "../../api/review.ts";

export type ExportGuide = {
  tool: string; steps: string; accepts: string; extensions: readonly string[];
  /** The editor the steps start in, linked so the person can open it from the card (R1-24). */
  link?: { label: string; href: string };
  /** The file is in a fixed place on this Mac that a file picker hides, so the card can read it with a button (R1-24). */
  readFromMac?: boolean;
};

// Which file each importer reads and where it comes from. The importers' ids are the boards' own (boards/*/board.json),
// so a new board with a known importer needs no change here.
const GUIDES: Record<string, ExportGuide> = {
  "oryx-source": {
    tool: "Oryx",
    steps: "Open your layout in Oryx, choose Download source, and drop the .zip it gives you.",
    accepts: ".zip",
    extensions: [".zip"],
    link: { label: "Open Oryx", href: "https://configure.zsa.io" },
  },
  "zmk-layout-editor-keymap": {
    tool: "the Layout Editor",
    steps: "Open your layout in the MoErgo Layout Editor, choose Export, and drop the .keymap file.",
    accepts: ".keymap",
    extensions: [".keymap"],
    link: { label: "Open the Layout Editor", href: "https://my.glove80.com" },
  },
  "zmk-keymap": {
    tool: "your ZMK config",
    steps: "Drop the .keymap file from your zmk-config repository, such as config/corne.keymap.",
    accepts: ".keymap",
    extensions: [".keymap"],
  },
  "karabiner-json": {
    tool: "Karabiner-Elements",
    steps: "Read Karabiner's settings from this Mac, or drop a copy of ~/.config/karabiner/karabiner.json. keyloom only reads it: your rules stay in the file, and keyloom shows the edit that stops Karabiner grabbing the built-in keyboard.",
    accepts: ".json",
    extensions: [".json"],
    readFromMac: true,
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

/**
 * The setup card's line under "Import a layout" (R6-11): where this board's layout comes from, from the same guide its import card uses.
 * A board the page can't look up gets a line that fits every board.
 */
export function importLine(board: BoardChoice | undefined): string {
  if (board === undefined) return "Drop the file your keyboard's own editor exports.";
  const guide = guideFor(board);
  return guide.readFromMac ? `Bring in what you set up in ${guide.tool}.` : `Drop the file from ${guide.tool}.`;
}

export const importCommand = (board: BoardChoice, activities: readonly ReviewActivity[] = []): string => `keyloom import --board ${board.id}${activities.length ? ` --activities ${activities.join(",")}` : ""} <file>`;

export function acceptsFile(guide: ExportGuide, filename: string): boolean {
  const name = filename.toLowerCase();
  return guide.extensions.some((extension) => name.endsWith(extension));
}

/**
 * Whether a failed "Read it from this Mac" offers Start blank (R3-12): only when this Mac has no Karabiner settings at all, so there is
 * nothing to bring in and a blank config is the way on. A refused or odd file keeps the drop, since the settings exist.
 */
export const offersStartBlank = (code: string | undefined): boolean => code === "karabiner_missing";

/** `base`, or `base 2`, `base 3`… : the first that no existing config uses. */
export function firstFreeName(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}
