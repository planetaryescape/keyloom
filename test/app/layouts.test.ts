import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  NotFoundError, UsageError, closeApp, exportLayout, getLayout, importLayout, layoutExportDocument, listLayouts, openApp,
} from "../../src/app/index.ts";
import { deepEqual } from "../../src/layout/equal.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

const open = () => openApp({ dataDir: tempDir() });
const input = { board: "zsa/moonlander", source: FIXTURE_DIR };

describe("importLayout", () => {
  test("stores a layout and its import revision and returns the report", async () => {
    const app = open();
    const out = await importLayout(app, input);
    expect(out.layoutId).toStartWith("lay_");
    expect(out.revisionId).toStartWith("rev_");
    expect(out.name).toBe("synchronized");
    expect(out.report.layers).toBe(6);
    const view = getLayout(app, out.layoutId);
    expect(view.revision).toMatchObject({ id: out.revisionId, origin: "import", parentId: null });
    expect(view.document.layers).toHaveLength(6);
    expect(view.board.definition.id).toBe("zsa/moonlander");
    closeApp(app);
  });

  test("the same source imported again gets a numbered name; an explicit clash is a usage error", async () => {
    const app = open();
    const a = await importLayout(app, input);
    const b = await importLayout(app, input);
    expect([a.name, b.name]).toEqual(["synchronized", "synchronized-2"]);
    await expect(importLayout(app, { ...input, name: "synchronized" })).rejects.toThrow(UsageError);
    expect((await importLayout(app, { ...input, name: "mine" })).name).toBe("mine");
    expect(listLayouts(app).map((l) => l.name)).toEqual(["synchronized", "synchronized-2", "mine"]);
    closeApp(app);
  });

  test("parallel imports each get their own layout and a distinct name", async () => {
    const app = open();
    const outs = await Promise.all(Array.from({ length: 5 }, () => importLayout(app, input)));
    expect(new Set(outs.map((o) => o.name)).size).toBe(5);
    expect(new Set(outs.map((o) => o.layoutId)).size).toBe(5);
    expect(listLayouts(app)).toHaveLength(5);
    closeApp(app);
  });

  test("bad names, boards and sources", async () => {
    const app = open();
    await expect(importLayout(app, { ...input, name: "   " })).rejects.toThrow(UsageError);
    await expect(importLayout(app, { ...input, name: "lay_sneaky" })).rejects.toThrow(UsageError);
    await expect(importLayout(app, { ...input, board: "no/such" })).rejects.toThrow(NotFoundError);
    await expect(importLayout(app, { ...input, board: "constructor" })).rejects.toThrow(NotFoundError);
    await expect(importLayout(app, { ...input, source: "/does/not/exist" })).rejects.toThrow(UsageError);
    expect(listLayouts(app)).toHaveLength(0); // nothing half-written
    closeApp(app);
  });

  test("a name is trimmed, and may be anything else (including prototype keys)", async () => {
    const app = open();
    expect((await importLayout(app, { ...input, name: "  spaced  " })).name).toBe("spaced");
    expect((await importLayout(app, { ...input, name: "constructor" })).name).toBe("constructor");
    expect(getLayout(app, "constructor").layout.name).toBe("constructor");
    closeApp(app);
  });
});

describe("keyloom layout documents", () => {
  /** Writes a document beside the test's temp files, returning its path and the object written. */
  async function write(document: unknown, name = "layout.json"): Promise<string> {
    const file = join(tempDir(), name);
    await Bun.write(file, JSON.stringify(document));
    return file;
  }

  test("an export imports back by its shape, whatever the file is called, with its whole document and a report", async () => {
    const app = open();
    const out = await importLayout(app, input);
    const exported = await exportLayout(app, out.layoutId, { out: join(tempDir(), "layout.txt") });
    expect(exported.document).toMatchObject({ kind: "keyloom-layout", schema_version: 1, board_id: "zsa/moonlander", layout_name: "synchronized" });

    const second = open();
    const back = await importLayout(second, { board: "zsa/moonlander", source: exported.path });
    expect(back.name).toBe("synchronized");
    expect(back.report).toMatchObject({ boardId: "zsa/moonlander", layers: 6, keysPerLayer: 72 });
    expect(back.report.bindings.native).toBeGreaterThanOrEqual(0);
    expect(deepEqual(getLayout(second, back.layoutId).document, exported.document.layout)).toBe(true);
    closeApp(app);
    closeApp(second);
  });

  test("the optional name and revision are not needed, and a name can be a prototype key", async () => {
    const app = open();
    const out = await importLayout(app, input);
    const document = layoutExportDocument(app, out.layoutId);
    const { layout_name: _name, revision_id: _revision, ...withoutOptional } = document;

    const bare = open();
    const back = await importLayout(bare, { board: "zsa/moonlander", source: await write(withoutOptional) });
    expect(back.name).toBe("Moonlander layout");
    expect(deepEqual(getLayout(bare, back.layoutId).document, document.layout)).toBe(true);

    const named = open();
    const prototype = await importLayout(named, { board: "zsa/moonlander", source: await write({ ...document, layout_name: "constructor" }) });
    expect(prototype.name).toBe("constructor");
    expect(getLayout(named, "constructor").layout.name).toBe("constructor");

    closeApp(app);
    closeApp(bare);
    closeApp(named);
  });

  test("a document whose board_id disagrees with its layout, or is for another board, is refused and stored nowhere", async () => {
    const app = open();
    const out = await importLayout(app, input);
    const document = layoutExportDocument(app, out.layoutId);

    const damaged = open();
    await expect(importLayout(damaged, { board: "zsa/moonlander", source: await write({ ...document, board_id: "foostan/corne" }) })).rejects.toThrow(/damaged/);
    expect(listLayouts(damaged)).toHaveLength(0);

    const mismatch = await importLayout(damaged, { board: "moergo/glove80", source: await write(document) }).then(() => null, (err: unknown) => err);
    expect(mismatch).toBeInstanceOf(UsageError);
    expect(String(mismatch)).toContain("is a layout for zsa/moonlander, not moergo/glove80");
    expect(listLayouts(damaged)).toHaveLength(0);
    closeApp(app);
    closeApp(damaged);
  });

  test("two imports of one document race safely, and a later one gets a numbered name", async () => {
    const app = open();
    const out = await importLayout(app, input);
    const file = await write(layoutExportDocument(app, out.layoutId));
    const second = open();
    const [a, b, c] = await Promise.all([
      importLayout(second, { board: "zsa/moonlander", source: file }),
      importLayout(second, { board: "zsa/moonlander", source: file }),
      importLayout(second, { board: "zsa/moonlander", source: file }),
    ]);
    expect(new Set([a.name, b.name, c.name]).size).toBe(3);
    expect(new Set([a.layoutId, b.layoutId, c.layoutId]).size).toBe(3);
    closeApp(app);
    closeApp(second);
  });
});

describe("getLayout", () => {  test("by id or by name, head or a named revision", async () => {
    const app = open();
    const out = await importLayout(app, input);
    expect(getLayout(app, "synchronized").layout.id).toBe(out.layoutId);
    expect(getLayout(app, out.layoutId, out.revisionId).revision.id).toBe(out.revisionId);
    closeApp(app);
  });

  test("unknown layout, unknown revision, and a revision of another layout are not found", async () => {
    const app = open();
    const a = await importLayout(app, input);
    const b = await importLayout(app, { ...input, name: "other" });
    expect(() => getLayout(app, "nope")).toThrow(NotFoundError);
    expect(() => getLayout(app, a.layoutId, "rev_nope")).toThrow(NotFoundError);
    expect(() => getLayout(app, a.layoutId, b.revisionId)).toThrow(NotFoundError);
    for (const proto of ["constructor", "__proto__", "toString"]) expect(() => getLayout(app, proto)).toThrow(NotFoundError);
    closeApp(app);
  });

  test("listLayouts is oldest first", async () => {
    const app = open();
    await importLayout(app, { ...input, name: "one" });
    await importLayout(app, { ...input, name: "two" });
    await importLayout(app, { ...input, name: "three" });
    expect(listLayouts(app).map((l) => l.name)).toEqual(["one", "two", "three"]);
    closeApp(app);
  });
});
