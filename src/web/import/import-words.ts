// What an import card says when keyloom refuses the file for a reason it can act on (R6-08, R6-18), from the server's code and the board
// it names, never from its sentence, which is the CLI's ("pass --board …", "keyloom keyboard restore …"); and what it says once an import
// has something to tell (R11-01).
import type { BoardChoice, ImportResponse } from "../../api/http.ts";
import type { ReviewActivity } from "../../api/review.ts";
import { ApiError } from "../api.ts";
import { keyboardRemoved } from "../keyboards/RestoreKeyboard.tsx";
import { KARABINER_ENTRY_WORDS } from "../sync/remapper-words.ts";

export type ImportRefusal =
  /**
   * The keyboard the file was going to was removed: Restore it, then import the same file to it again. It is the card's own board, or
   * the board an Import it as … chose, so the words and Restore name the board the server refused, not always the card's (#299 review).
   */
  | { kind: "removed"; boardId: string; board: BoardChoice | null }
  /** The file is a keyloom export for another board: import it as that board's config, when keyloom has the board. */
  | { kind: "other_board"; boardId: string; board: BoardChoice | null };

/** `as`: the board the refused request went to, for a refusal that doesn't name one. */
export function importRefusal(error: unknown, boards: readonly BoardChoice[], as: Pick<BoardChoice, "id">): ImportRefusal | null {
  if (!(error instanceof ApiError)) return null;
  const find = (id: string) => boards.find((b) => b.id === id) ?? null;
  if (keyboardRemoved(error)) {
    const boardId = error.board ?? as.id;
    return { kind: "removed", boardId, board: find(boardId) };
  }
  if (error.code === "layout_for_other_board" && error.board !== undefined) return { kind: "other_board", boardId: error.board, board: find(error.board) };
  return null;
}

/** A refused import or blank config, with what Restore and Import it as … need to do it again: the file, and the board it went to. */
export type Refused = { refusal: ImportRefusal; file: File | null; as: BoardChoice };

/** What Restore says and restores for a removed keyboard: the refused board, by its name when keyloom has it. */
export const restoreFor = (refused: Refused & { refusal: { kind: "removed" } }): { boardId: string; boardName: string; doing: string } => ({
  boardId: refused.refusal.boardId,
  boardName: refused.refusal.board?.name ?? (refused.refusal.boardId === refused.as.id ? refused.as.name : refused.refusal.boardId),
  doing: refused.file === null ? "start a config" : "import this layout",
});

/** What happens after Restore: the kept file imported to the same board again, or Start blank when there was no file. */
export const retryFor = (refused: Refused): { kind: "blank" } | { kind: "import"; file: File; as: BoardChoice } =>
  refused.file === null ? { kind: "blank" } : { kind: "import", file: refused.file, as: refused.as };

export function otherBoardWords(filename: string, refusal: Extract<ImportRefusal, { kind: "other_board" }>, here: BoardChoice): string {
  return refusal.board === null
    ? `${filename} is a layout for a keyboard keyloom doesn't have (${refusal.boardId}), not the ${here.name}. keyloom can import it once it has that keyboard.`
    : `${filename} is a layout for the ${refusal.board.name}, not the ${here.name}.`;
}

/** kanata has no firmware to test on, so a MacBook import takes no activity tests (R6-25), whatever is ticked above the cards. */
export const activitiesFor = (board: Pick<BoardChoice, "firmware">, activities: readonly ReviewActivity[]): ReviewActivity[] =>
  board.firmware === "kanata" ? [] : [...activities];

/**
 * What an import card says once the layout is saved, when the import has something to tell (R11-01): the Karabiner edit the card promised,
 * and the importer's warnings. Null when there is nothing, so the layout opens at once as before.
 */
export type ImportedNote = {
  title: string;
  karabiner: { text: string; entry: string; unimported: string | null } | null;
  warnings: string[];
  open: string;
};

export function importedNote(result: ImportResponse): ImportedNote | null {
  const edit = result.karabinerEdit;
  if (edit === undefined && result.warnings.length === 0) return null;
  const layers = `${result.layers} ${result.layers === 1 ? "layer" : "layers"}`;
  return {
    title: `Imported ${result.name}, ${layers}`,
    karabiner: edit === undefined ? null : {
      text: `Karabiner-Elements still takes the built-in keyboard, so it and kanata would both grab it. keyloom never edits karabiner.json, so ${KARABINER_ENTRY_WORDS}`,
      entry: edit.entry,
      unimported: edit.unimported === 0 ? null
        : `${edit.unimported === 1 ? "1 rule keyloom didn't import stops" : `${edit.unimported} rules keyloom didn't import stop`} working on the built-in keyboard once Karabiner leaves it alone. ${edit.unimported === 1 ? "It's" : "They're"} listed below.`,
    },
    warnings: result.warnings,
    open: `Open ${result.name}`,
  };
}
