import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { MIGRATIONS } from "./migrations.ts";
import { databasePath } from "./paths.ts";

/** Opens (creating if needed) the database in `dir`, in WAL mode, with migrations applied. */
export function openDatabase(dir: string): Database {
  mkdirSync(dir, { recursive: true });
  const db = new Database(databasePath(dir), { create: true, strict: true });
  // busy_timeout first: the server and the CLI can open the same file at once (01).
  db.run("PRAGMA busy_timeout = 5000");
  enableWal(db);
  db.run("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/**
 * Switching a new file to WAL needs an exclusive lock, and SQLite returns SQLITE_BUSY for that at
 * once instead of waiting out busy_timeout. Two processes opening a fresh database together
 * (the server and a CLI import) would otherwise fail, so retry for a few seconds.
 */
function enableWal(db: Database): void {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      db.run("PRAGMA journal_mode = WAL");
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== "SQLITE_BUSY" || Date.now() > deadline) throw err;
      Bun.sleepSync(25);
    }
  }
}

export function migrate(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  for (const m of MIGRATIONS) {
    // The applied check is inside the write transaction, so two processes starting together
    // can't both run the same migration.
    db.transaction(() => {
      const applied = db.query("SELECT 1 FROM schema_migrations WHERE version = ?").get(m.version);
      if (applied) return;
      db.exec(m.sql);
      db.query("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, Date.now());
    }).immediate();
  }
}
