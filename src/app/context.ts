import type { Database } from "bun:sqlite";
import { setUserBoards } from "../boards/registry.ts";
import { readUserBoards } from "../boards/user-boards.ts";
import { openDatabase } from "../persistence/db.ts";
import { dataDir } from "../persistence/paths.ts";

/** What every use case runs against. One per process; the server and the CLI each open their own. */
export type App = {
  db: Database;
  dataDir: string;
};

export function openApp(opts: { dataDir?: string } = {}): App {
  const dir = dataDir(opts.dataDir);
  // Derived boards live in the data directory, so a layout stored for one can be opened; a folder that fails to load is left out here, and `keyboard list` says why.
  setUserBoards(readUserBoards(dir).boards);
  return { db: openDatabase(dir), dataDir: dir };
}

export function closeApp(app: App): void {
  app.db.close();
}
