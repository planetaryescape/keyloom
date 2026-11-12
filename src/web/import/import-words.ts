// What an import card says when keyloom refuses the file for a reason it can act on (R6-08, R6-18), from the server's code and the board
// it names, never from its sentence, which is the CLI's ("pass --board …", "keyloom keyboard restore …").
import type { BoardChoice } from "../../api/http.ts";
import type { ReviewActivity } from "../../api/review.ts";
import { ApiError } from "../api.ts";
import { keyboardRemoved } from "../keyboards/RestoreKeyboard.tsx";

export type ImportRefusal =
  /** The card's keyboard was removed: Restore it, then import the same file again. */
  | { kind: "removed" }
  /** The file is a keyloom export for another board: import it as that board's config, when keyloom has the board. */
  | { kind: "other_board"; boardId: string; board: BoardChoice | null };

export function importRefusal(error: unknown, boards: readonly BoardChoice[]): ImportRefusal | null {
  if (!(error instanceof ApiError)) return null;
  if (keyboardRemoved(error)) return { kind: "removed" };
  if (error.code === "layout_for_other_board" && error.board !== undefined) {
    const boardId = error.board;
    return { kind: "other_board", boardId, board: boards.find((b) => b.id === boardId) ?? null };
  }
  return null;
}

export function otherBoardWords(filename: string, refusal: Extract<ImportRefusal, { kind: "other_board" }>, here: BoardChoice): string {
  return refusal.board === null
    ? `${filename} is a layout for a keyboard keyloom doesn't have (${refusal.boardId}), not the ${here.name}. keyloom can import it once it has that keyboard.`
    : `${filename} is a layout for the ${refusal.board.name}, not the ${here.name}.`;
}

/** kanata has no firmware to test on, so a MacBook import takes no activity tests (R6-25), whatever is ticked above the cards. */
export const activitiesFor = (board: Pick<BoardChoice, "firmware">, activities: readonly ReviewActivity[]): ReviewActivity[] =>
  board.firmware === "kanata" ? [] : [...activities];
