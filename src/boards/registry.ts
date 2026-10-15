// The boards keyloom ships with, embedded at bundle time (see embedded.macro.ts).
import { readBoards } from "./embedded.macro.ts" with { type: "macro" };
import { type Board, BoardNotFoundError, parseBoard } from "./load.ts";

const boards = new Map<string, Board>();
for (const e of readBoards()) {
  // One unfinished or broken folder must not stop every command, including the `boards check` that
  // reports what is wrong with it. Released builds only carry boards that CI has checked.
  try {
    if (e.board === "" || e.geometry === "") throw new Error(`${e.board === "" ? "board.json" : "geometry.json"} is missing`);
    const board = parseBoard(e.board, e.geometry, e.skill);
    // The ID is the folder path (04). A mismatch would make `--board` resolve to the wrong thing.
    if (board.definition.id !== e.dir) {
      throw new Error(`board.json declares id ${board.definition.id}; the id must equal the folder path`);
    }
    boards.set(board.definition.id, board);
  } catch (err) {
    // A folder with only board.json is a contributor between steps 2 and 3; point at the step that finishes it.
    const next = e.board !== "" && e.geometry === "" ? `keyloom boards geometry boards/${e.dir}` : `keyloom boards check boards/${e.dir}`;
    console.error(`keyloom: skipping boards/${e.dir} for now: ${(err as Error).message}. Next: ${next}`);
  }
}

export function listBoards(): Board[] {
  return [...boards.values()];
}

export function getBoard(id: string): Board {
  const board = boards.get(id);
  if (!board) {
    throw new BoardNotFoundError(`no board "${id}". Known boards: ${[...boards.keys()].join(", ") || "none"}`);
  }
  return board;
}
