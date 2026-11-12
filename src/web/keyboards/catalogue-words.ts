// What the first-run keyboard list says before it has rows to show (R6-04). "No supported board matches" is said only once keyloom's
// board list and the collection were both read, so a failed or slow read never sends a Moonlander owner off to search QMK and ZMK.

/** Where the read of keyloom's board list stands. */
export type BoardsRead = "loading" | "failed" | "ready";

export type CatalogueNote = "boards_loading" | "boards_failed" | "collection_loading" | "collection_failed" | "none" | null;

/** `rows` is how many boards match the filter; `firmwareSearch` is true once the QMK and ZMK search runs, which then says what's next. */
export function catalogueNote(boards: BoardsRead, collection: "loading" | "failed" | "ready", rows: number, firmwareSearch: boolean): CatalogueNote {
  if (boards === "failed") return "boards_failed";
  if (boards === "loading") return "boards_loading";
  if (collection === "failed") return "collection_failed";
  if (collection === "loading") return "collection_loading";
  return rows === 0 && !firmwareSearch ? "none" : null;
}
