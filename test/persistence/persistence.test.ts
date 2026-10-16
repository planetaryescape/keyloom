import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { openDatabase, migrate } from "../../src/persistence/db.ts";
import { newId } from "../../src/persistence/ids.ts";
import { NameTakenError, createLayout, findLayoutRow, findRevision, listLayoutRows } from "../../src/persistence/layouts.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { dataDir, databasePath } from "../../src/persistence/paths.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";
import { SLOW_RUNNER_MS } from "../helpers/timeouts.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);

describe("migrations", () => {
  test("every SQL file in migrations/ is registered, in order, with matching versions", () => {
    const files = readdirSync(`${import.meta.dir}/../../src/persistence/migrations`).filter((f) => f.endsWith(".sql")).sort();
    expect(MIGRATIONS.map((m) => `${m.name}.sql`)).toEqual(files);
    // The version is the file's number, so parallel branches can add 0002 and 0003 independently.
    for (const m of MIGRATIONS) expect(m.version).toBe(Number(m.name.slice(0, 4)));
  });

  test("opening twice applies each migration once and keeps data", () => {
    const dir = tempDir();
    const a = openDatabase(dir);
    createLayout(a, { name: "keep", layout, summary: "s", origin: "import" });
    a.close();
    const b = openDatabase(dir);
    expect(b.query("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: MIGRATIONS.length });
    expect(listLayoutRows(b)).toHaveLength(1);
    b.close();
  });

  test("two processes opening a new database at once don't both migrate it", async () => {
    const dir = tempDir();
    const script = `import { openDatabase } from ${JSON.stringify(join(import.meta.dir, "../../src/persistence/db.ts"))}; const db = openDatabase(${JSON.stringify(dir)}); console.log(db.query("SELECT COUNT(*) AS n FROM schema_migrations").get().n); db.close();`;
    const run = () => Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
    const procs = Array.from({ length: 4 }, run);
    const results = await Promise.all(procs.map(async (p) => ({ code: await p.exited, out: (await new Response(p.stdout).text()).trim(), err: await new Response(p.stderr).text() })));
    for (const r of results) {
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out).toBe(String(MIGRATIONS.length));
    }
  }, SLOW_RUNNER_MS);

  test("the database is in WAL mode with foreign keys on", () => {
    const db = openDatabase(tempDir());
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  test("the schema is the one in 02 (layouts and revisions)", () => {
    const db = openDatabase(tempDir());
    const cols = (t: string) => (db.query(`PRAGMA table_info(${t})`).all() as Array<{ name: string; notnull: number }>).map((c) => c.name);
    expect(cols("layouts")).toEqual(["id", "board_id", "name", "head_revision_id", "created_at", "updated_at", "archived_at", "copied_from_layout_id", "copied_from_revision_id"]);
    expect(cols("revisions")).toEqual(["id", "layout_id", "parent_id", "document", "origin", "change_set_id", "undoes_revision_id", "summary", "created_at"]);
    expect(() => db.run("INSERT INTO revisions (id, layout_id, document, origin, summary, created_at) VALUES ('r', 'l', '{}', 'bogus', 's', 1)")).toThrow();
    db.close();
  });

  test("migrate is safe to call again on an open database", () => {
    const db = openDatabase(tempDir());
    migrate(db);
    expect(db.query("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: MIGRATIONS.length });
    db.close();
  });
});

describe("layouts and revisions", () => {
  test("create stores a layout and its first revision with prefixed ULIDs", () => {
    const db = openDatabase(tempDir());
    const { layout: row, revision } = createLayout(db, { name: "mine", layout, summary: "Imported", origin: "import", now: 1000 });
    expect(row.id).toMatch(/^lay_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(revision.id).toMatch(/^rev_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(row).toMatchObject({ name: "mine", boardId: "zsa/moonlander", headRevisionId: revision.id, createdAt: 1000, updatedAt: 1000 });
    expect(revision).toMatchObject({ layoutId: row.id, parentId: null, origin: "import", summary: "Imported" });
    const found = findRevision(db, row.id, revision.id);
    expect(found?.layout).toEqual(layout);
    db.close();
  });

  test("lookup by id or by name; an id wins over a name that equals it", () => {
    const db = openDatabase(tempDir());
    const a = createLayout(db, { name: "alpha", layout, summary: "s", origin: "import" }).layout;
    const b = createLayout(db, { name: a.id, layout, summary: "s", origin: "import" }).layout; // named like a's id
    expect(findLayoutRow(db, a.id)?.id).toBe(a.id);
    expect(findLayoutRow(db, "alpha")?.id).toBe(a.id);
    expect(findLayoutRow(db, b.id)?.id).toBe(b.id);
    expect(findLayoutRow(db, "missing")).toBeUndefined();
    for (const proto of ["constructor", "__proto__", "toString", ""]) expect(findLayoutRow(db, proto)).toBeUndefined();
    db.close();
  });

  test("a name is unique, and the loser of the race gets a typed error", () => {
    const db = openDatabase(tempDir());
    createLayout(db, { name: "dup", layout, summary: "s", origin: "import" });
    expect(() => createLayout(db, { name: "dup", layout, summary: "s", origin: "import" })).toThrow(NameTakenError);
    expect(listLayoutRows(db)).toHaveLength(1); // the failed insert left nothing behind
    expect(db.query("SELECT COUNT(*) AS n FROM revisions").get()).toEqual({ n: 1 });
    db.close();
  });

  test("a revision is only found through its own layout", () => {
    const db = openDatabase(tempDir());
    const a = createLayout(db, { name: "a", layout, summary: "s", origin: "import" });
    const b = createLayout(db, { name: "b", layout, summary: "s", origin: "import" });
    expect(findRevision(db, a.layout.id, b.revision.id)).toBeUndefined();
    expect(findRevision(db, b.layout.id, b.revision.id)).toBeDefined();
    db.close();
  });

  test("listing does not depend on storage order: oldest first, ties broken by id", () => {
    const db = openDatabase(tempDir());
    // Same millisecond for all, and a rowid order that differs from the sort order.
    const ids = ["c", "a", "b"].map((n) => createLayout(db, { name: n, layout, summary: "s", origin: "import", now: 5 }).layout);
    const sorted = [...ids].sort((x, y) => (x.id < y.id ? -1 : 1)).map((l) => l.id);
    expect(listLayoutRows(db).map((l) => l.id)).toEqual(sorted);
    createLayout(db, { name: "earlier", layout, summary: "s", origin: "import", now: 1 });
    expect(listLayoutRows(db)[0]?.name).toBe("earlier");
    db.close();
  });

  test("ids made in the same millisecond still sort in creation order", () => {
    const ids = Array.from({ length: 500 }, () => newId("lay"));
    expect([...ids].sort()).toEqual(ids);
  });

  test("a stored document that no longer parses fails loudly instead of being coerced", () => {
    const db = openDatabase(tempDir());
    const { layout: row, revision } = createLayout(db, { name: "bad", layout, summary: "s", origin: "import" });
    db.query("UPDATE revisions SET document = ? WHERE id = ?").run(JSON.stringify({ ...layout, layers: [] }), revision.id);
    expect(() => findRevision(db, row.id, revision.id)).toThrow();
    db.query("UPDATE revisions SET document = ? WHERE id = ?").run("not json", revision.id);
    expect(() => findRevision(db, row.id, revision.id)).toThrow();
    db.close();
  });

  test("a revision whose layout row is missing is rejected by the foreign key", () => {
    const db = openDatabase(tempDir());
    expect(() =>
      db.run("INSERT INTO revisions (id, layout_id, document, origin, summary, created_at) VALUES ('rev_x', 'lay_missing', '{}', 'import', 's', 1)"),
    ).toThrow();
    db.close();
  });

  test("two connections writing at once both land (WAL + busy timeout)", async () => {
    const dir = tempDir();
    openDatabase(dir).close();
    const script = (name: string) => `import { openDatabase } from ${JSON.stringify(join(import.meta.dir, "../../src/persistence/db.ts"))}; import { createLayout } from ${JSON.stringify(join(import.meta.dir, "../../src/persistence/layouts.ts"))}; const layout = await Bun.file(${JSON.stringify(join(dir, "layout.json"))}).json(); const db = openDatabase(${JSON.stringify(dir)}); for (let i = 0; i < 25; i++) createLayout(db, { name: ${JSON.stringify(name)} + i, layout, summary: "s", origin: "import" }); db.close();`;
    await Bun.write(join(dir, "layout.json"), JSON.stringify(layout));
    const procs = ["x", "y", "z"].map((n) => Bun.spawn(["bun", "-e", script(n)], { stdout: "pipe", stderr: "pipe" }));
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes).toEqual([0, 0, 0]);
    const db = new Database(databasePath(dir), { readonly: true });
    expect(db.query("SELECT COUNT(*) AS n FROM layouts").get()).toEqual({ n: 75 });
    expect(db.query("SELECT COUNT(*) AS n FROM revisions").get()).toEqual({ n: 75 });
    db.close();
  }, SLOW_RUNNER_MS);
});

describe("paths", () => {
  test("the override wins; XDG_DATA_HOME is honoured; the default is ~/.local/share/keyloom", () => {
    const saved = process.env.XDG_DATA_HOME;
    try {
      expect(dataDir("/somewhere")).toBe("/somewhere");
      process.env.XDG_DATA_HOME = "/xdg";
      expect(dataDir()).toBe("/xdg/keyloom");
      process.env.XDG_DATA_HOME = "";
      expect(dataDir()).toMatch(/\/\.local\/share\/keyloom$/);
      delete process.env.XDG_DATA_HOME;
      expect(dataDir()).toMatch(/\/\.local\/share\/keyloom$/);
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });
});
