// A database a newer keyloom has migrated must not be opened by an older one: `migrate` ignores rows it doesn't know, so an old binary
// would read and write tables whose meaning has moved on (D-455).
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import pkg from "../../package.json" with { type: "json" };
import { MIGRATIONS } from "./migrations.ts";
import { databasePath } from "./paths.ts";

export class SchemaTooNewError extends Error {
  override name = "SchemaTooNewError";
  constructor(readonly databaseSchema: number, readonly knownSchema: number, where: string) {
    super(
      `${where} is at database schema ${databaseSchema}, but keyloom ${pkg.version} only knows schema ${knownSchema}. A newer keyloom has already upgraded it, and this one would misread it. Upgrade keyloom (re-run install.sh, or update the app) and try again.`,
    );
  }
}

const KNOWN_SCHEMA = Math.max(...MIGRATIONS.map((m) => m.version));

/** Throws if the database holds a migration this binary doesn't have. Reads only, so it is safe before `migrate` and beside a running server. */
export function assertSchemaKnown(db: Database, where: string): void {
  const table = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) return;
  const row = db.query("SELECT MAX(version) AS newest FROM schema_migrations").get() as { newest: number | null };
  if (row.newest !== null && row.newest > KNOWN_SCHEMA) throw new SchemaTooNewError(row.newest, KNOWN_SCHEMA, where);
}

/** The same check on a data directory, without creating or migrating anything; a directory with no database yet is fine. */
export function assertDataDirOpenable(dir: string): void {
  const path = databasePath(dir);
  if (!existsSync(path)) return;
  const db = new Database(path, { readonly: true, strict: true });
  try {
    db.run("PRAGMA busy_timeout = 5000");
    assertSchemaKnown(db, path);
  } finally {
    db.close();
  }
}
