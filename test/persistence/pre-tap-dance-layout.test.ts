// Layouts stored before rung 14 have no tapDances. They must load, and the next save must write the field (D-150).
import { describe, expect, test } from "bun:test";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { LayoutSchema } from "../../src/layout/schema.ts";
import { openDatabase } from "../../src/persistence/db.ts";
import { createLayout, findRevision } from "../../src/persistence/layouts.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

const sample = await Bun.file(`${import.meta.dir}/../fixtures/web/moonlander-sample.json`).json();
const board = await moonlander();

describe("a layout stored before tap dances existed", () => {
  test("the sample fixture really predates the field", () => {
    expect("tapDances" in sample.document).toBe(false);
  });

  test("parses with no tap dances", () => {
    const parsed = LayoutSchema.parse(sample.document);
    expect(parsed.tapDances).toEqual([]);
    expect(parsed.layers.length).toBeGreaterThan(0);
  });

  test("loads from the database as it was stored, and saves with the field after an edit", () => {
    const db = openDatabase(tempDir());
    const row = createLayout(db, { name: "old", layout: sample.document, summary: "stored before rung 14", origin: "import" });
    // The row holds exactly the old JSON: no tapDances key.
    const raw = db.query("SELECT document FROM revisions WHERE id = ?").get(row.revision.id) as { document: string };
    expect("tapDances" in JSON.parse(raw.document)).toBe(false);
    const loaded = findRevision(db, row.layout.id, row.revision.id);
    expect(loaded?.layout.tapDances).toEqual([]);
    expect(loaded?.layout.layers).toEqual(sample.document.layers);
    db.close();
  });

  test("an imported layout writes tapDances, and a re-read gives the same document", async () => {
    const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
    const db = openDatabase(tempDir());
    const row = createLayout(db, { name: "new", layout, summary: "s", origin: "import" });
    expect(findRevision(db, row.layout.id, row.revision.id)?.layout).toEqual(layout);
    expect(JSON.parse((db.query("SELECT document FROM revisions WHERE id = ?").get(row.revision.id) as { document: string }).document).tapDances).toHaveLength(2);
    db.close();
  });
});
