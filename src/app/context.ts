import type { Database } from "bun:sqlite";
import { openDatabase } from "../persistence/db.ts";
import { dataDir } from "../persistence/paths.ts";

/** What every use case runs against. One per process; the server and the CLI each open their own. */
export type App = {
  db: Database;
  dataDir: string;
};

export function openApp(opts: { dataDir?: string } = {}): App {
  const dir = dataDir(opts.dataDir);
  return { db: openDatabase(dir), dataDir: dir };
}

export function closeApp(app: App): void {
  app.db.close();
}
