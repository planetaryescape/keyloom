// Boards the person derived from a keyboard on their desk (22#storing-the-derived-board), kept in the data directory beside the
// database: `<data dir>/boards/<vendor>/<board>/board.json` and `geometry.json`, the same two files a contributed board is. They
// load next to the boards keyloom ships, and a folder here can be sent upstream as it stands.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeGeometry } from "./geometry.ts";
import { type Board, parseBoard } from "./load.ts";

export const userBoardsRoot = (dataDir: string): string => join(dataDir, "boards");

export const userBoardDir = (dataDir: string, id: string): string => join(userBoardsRoot(dataDir), ...id.split("/"));

/** Writes the two files for a board, replacing a folder of the same id. Returns the folder. */
export function writeUserBoard(dataDir: string, board: Pick<Board, "definition" | "geometry">): string {
  const dir = userBoardDir(dataDir, board.definition.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "board.json"), `${JSON.stringify(board.definition, null, 2)}\n`);
  writeFileSync(join(dir, "geometry.json"), serializeGeometry(board.geometry));
  return dir;
}

export type UserBoards = { boards: Board[]; /** One line per folder that could not be loaded, so a broken one is reported and does not stop the rest. */ problems: string[] };

/** Every board folder under the data directory's `boards/`. A folder that fails to parse is reported, not thrown. */
export function readUserBoards(dataDir: string): UserBoards {
  const root = userBoardsRoot(dataDir);
  const out: UserBoards = { boards: [], problems: [] };
  if (!existsSync(root)) return out;
  for (const vendor of readdirSync(root, { withFileTypes: true })) {
    if (!vendor.isDirectory()) continue;
    for (const entry of readdirSync(join(root, vendor.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, vendor.name, entry.name);
      try {
        const board = parseBoard(readFileSync(join(dir, "board.json"), "utf8"), readFileSync(join(dir, "geometry.json"), "utf8"));
        if (board.definition.id !== `${vendor.name}/${entry.name}`) throw new Error(`board.json declares id ${board.definition.id}; the id must equal the folder path`);
        out.boards.push(board);
      } catch (err) {
        out.problems.push(`${dir}: ${(err as Error).message}`);
      }
    }
  }
  return out;
}
