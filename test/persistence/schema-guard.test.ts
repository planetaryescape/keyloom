// A database a newer keyloom migrated is refused before any migration runs (D-455).
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { openDatabase } from "../../src/persistence/db.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { databasePath } from "../../src/persistence/paths.ts";
import { SchemaTooNewError, assertDataDirOpenable } from "../../src/persistence/schema-guard.ts";
import { tempDir } from "../helpers/tmp.ts";

const newest = Math.max(...MIGRATIONS.map((m) => m.version));

/** A data directory whose database holds one migration row from the future, and nothing else. */
function futureDir(version = newest + 1): string {
  const dir = tempDir();
  const db = new Database(databasePath(dir), { create: true });
  db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  db.query("INSERT INTO schema_migrations VALUES (?, 'from_the_future', 0)").run(version);
  db.close();
  return dir;
}

const tables = (dir: string): string[] => {
  const db = new Database(databasePath(dir), { readonly: true });
  try {
    return (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  } finally {
    db.close();
  }
};

describe("schema guard", () => {
  test("a database one migration ahead is refused, and nothing was migrated", () => {
    const dir = futureDir();
    expect(() => openDatabase(dir)).toThrow(SchemaTooNewError);
    // If migrate had run first, `layouts` would exist.
    expect(tables(dir)).toEqual(["schema_migrations"]);
  });

  test("the message names the database's schema, this binary's version and what it knows, and says to upgrade", () => {
    const dir = futureDir(999);
    const err = (() => {
      try {
        openDatabase(dir);
      } catch (e) {
        return e as SchemaTooNewError;
      }
      throw new Error("expected a refusal");
    })();
    expect(err.databaseSchema).toBe(999);
    expect(err.knownSchema).toBe(newest);
    expect(err.message).toContain("schema 999");
    expect(err.message).toContain(`schema ${newest}`);
    expect(err.message).toMatch(/keyloom \d+\.\d+\.\d+/);
    expect(err.message).toMatch(/Upgrade keyloom/);
  });

  test("a database at this schema opens again, and a fresh one (older than any) is migrated", () => {
    const dir = tempDir();
    openDatabase(dir).close();
    openDatabase(dir).close();
    const db = new Database(databasePath(dir), { readonly: true });
    expect((db.query("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v).toBe(newest);
    db.close();
  });

  test("the read-only check refuses a newer database without touching it, and accepts a missing or new one", () => {
    const dir = futureDir();
    expect(() => assertDataDirOpenable(dir)).toThrow(SchemaTooNewError);
    expect(tables(dir)).toEqual(["schema_migrations"]);
    expect(() => assertDataDirOpenable(tempDir())).not.toThrow();
    const fresh = tempDir();
    openDatabase(fresh).close();
    expect(() => assertDataDirOpenable(fresh)).not.toThrow();
  });
});
