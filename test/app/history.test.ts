import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import {
  type App, NotFoundError, StaleBaseError, UsageError, applyOps, closeApp, getLayout, importLayout, listLayouts, listRevisions, openApp, undo,
} from "../../src/app/index.ts";
import { importUpload } from "../../src/app/import-upload.ts";
import { ValidationFailedError } from "../../src/app/index.ts";
import { appendRevision } from "../../src/persistence/revisions.ts";
import { safeFilename } from "../../src/app/import-upload.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { setKey } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";

async function setup(): Promise<{ app: App; ref: string; revisions: string[] }> {
  const app = openApp({ dataDir: tempDir() });
  const out = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
  const revisions = [out.revisionId];
  for (const code of ["F17", "F18", "F19"]) {
    const head = getLayout(app, out.layoutId).revision.id;
    revisions.push(applyOps(app, out.layoutId, { baseRevisionId: head, ops: setKey(6, code), summary: `Layer 0, key 7: ${code}` }).revisionId);
  }
  return { app, ref: out.layoutId, revisions };
}
const key6 = (app: App, ref: string) => getLayout(app, ref).document.layers[0]?.bindings[6];

describe("listRevisions", () => {
  test("lists the head first and the import last, whatever the timestamps say", async () => {
    const { app, ref, revisions } = await setup();
    // Equal times must not reorder history: the parent links are the order.
    app.db.run("UPDATE revisions SET created_at = 1000");
    expect(listRevisions(app, ref).map((r) => r.id)).toEqual([...revisions].reverse());
    closeApp(app);
  });

  test("an unknown layout is not found", async () => {
    const { app } = await setup();
    expect(() => listRevisions(app, "nope")).toThrow(NotFoundError);
    closeApp(app);
  });
});

describe("undo to an earlier revision", () => {
  test("three revisions back is one new revision holding that document, and the old ones stay", async () => {
    const { app, ref, revisions } = await setup();
    const head = revisions[3] as string;
    const out = undo(app, ref, { revisionId: head, to: revisions[0] as string });
    expect(key6(app, ref)).toEqual({ kind: "key", code: "F16" });
    expect(out.revision).toMatchObject({ origin: "undo", parentId: head, summary: expect.stringContaining("Back to: ") });
    expect(listRevisions(app, ref)).toHaveLength(5);
    closeApp(app);
  });

  test("undoing the go-back puts the later work back", async () => {
    const { app, ref, revisions } = await setup();
    undo(app, ref, { revisionId: revisions[3] as string, to: revisions[1] as string });
    expect(key6(app, ref)).toEqual({ kind: "key", code: "F17" });
    undo(app, ref, {});
    expect(key6(app, ref)).toEqual({ kind: "key", code: "F19" });
    expect(listRevisions(app, ref)[0]?.summary).toStartWith("Redo: Back to: ");
    closeApp(app);
  });

  test("going back to an undo does not stack prefixes: 'Back to: Back to: ...' reads as the work it restores", async () => {
    const { app, ref, revisions } = await setup();
    undo(app, ref, { revisionId: revisions[3] as string, to: revisions[1] as string });
    const head = listRevisions(app, ref)[0] as { id: string };
    undo(app, ref, { revisionId: head.id, to: revisions[3] as string });
    expect(listRevisions(app, ref)[0]?.summary).toBe("Back to: Layer 0, key 7: F19");
    closeApp(app);
  });

  test("two go-backs from the same head: the second finds the head moved and writes nothing", async () => {
    const { app, ref, revisions } = await setup();
    const head = revisions[3] as string;
    undo(app, ref, { revisionId: head, to: revisions[0] as string });
    expect(() => undo(app, ref, { revisionId: head, to: revisions[1] as string })).toThrow(StaleBaseError);
    expect(listRevisions(app, ref)).toHaveLength(5);
    closeApp(app);
  });

  test("a revision with a problem the head doesn't have is refused, and one the head shares is not", async () => {
    const { app, ref, revisions } = await setup();
    const view = getLayout(app, ref);
    const broken = structuredClone(view.document);
    broken.layers[0]!.bindings[6] = { kind: "key", code: "NOT_A_KEY" };
    const bad = appendRevision(app.db, { layoutId: view.layout.id, expectedHeadId: revisions[3] as string, layout: broken, origin: "editor", summary: "broken on purpose" });
    const fixed = appendRevision(app.db, { layoutId: view.layout.id, expectedHeadId: bad.id, layout: view.document, origin: "editor", summary: "fixed again" });
    const refused = (() => {
      try {
        undo(app, ref, { revisionId: fixed.id, to: bad.id });
      } catch (err) {
        return err;
      }
      throw new Error("expected a refusal");
    })();
    expect(refused).toBeInstanceOf(ValidationFailedError);
    expect((refused as ValidationFailedError).details).toMatchObject({ ok: false, errors: [{ code: "firmware_unsupported" }] });
    expect(listRevisions(app, ref)[0]?.id).toBe(fixed.id);
    // The head itself has the problem: restoring a revision with the same one is allowed, so an imported flaw never traps BK.
    const again = appendRevision(app.db, { layoutId: view.layout.id, expectedHeadId: fixed.id, layout: broken, origin: "editor", summary: "broken again" });
    expect(() => undo(app, ref, { revisionId: again.id, to: bad.id })).not.toThrow();
    closeApp(app);
  });

  test("a stale head is refused and writes nothing", async () => {
    const { app, ref, revisions } = await setup();
    expect(() => undo(app, ref, { revisionId: revisions[2] as string, to: revisions[0] as string })).toThrow(StaleBaseError);
    expect(listRevisions(app, ref)).toHaveLength(4);
    closeApp(app);
  });

  test("the head itself and a revision of another layout are refused", async () => {
    const { app, ref, revisions } = await setup();
    expect(() => undo(app, ref, { revisionId: revisions[3] as string, to: revisions[3] as string })).toThrow(UsageError);
    expect(() => undo(app, ref, { revisionId: revisions[3] as string, to: "rev_elsewhere" })).toThrow(NotFoundError);
    closeApp(app);
  });
});

describe("importing an uploaded file", () => {
  const read = (path: string) => new Uint8Array(readFileSync(path));

  test("an Oryx source zip becomes a layout", async () => {
    const app = openApp({ dataDir: tempDir() });
    const files = Object.fromEntries(["keymap.c", "config.h", "rules.mk", "keymap.json"].map((f) => [`zsa_moonlander_synchronized_source/${f}`, read(join(FIXTURE_DIR, f))]));
    const out = await importUpload(app, { board: "zsa/moonlander", filename: "zsa_moonlander_synchronized_source.zip", bytes: zipSync(files) });
    expect(listLayouts(app).map((l) => l.id)).toEqual([out.layoutId]);
    expect(out.report.layers).toBeGreaterThan(1);
    closeApp(app);
  });

  test("a Layout Editor .keymap becomes a Glove80 layout", async () => {
    const app = openApp({ dataDir: tempDir() });
    const bytes = read(join(import.meta.dir, "../fixtures/zmk/glove80-template/glove80.keymap"));
    const out = await importUpload(app, { board: "moergo/glove80", filename: "glove80.keymap", bytes });
    expect(getLayout(app, out.layoutId).layout.boardId).toBe("moergo/glove80");
    closeApp(app);
  });

  test("a file that is not a zip or a keymap, an empty file, and a wrong board are refused", async () => {
    const app = openApp({ dataDir: tempDir() });
    await expect(importUpload(app, { board: "zsa/moonlander", filename: "notes.txt", bytes: new Uint8Array([1]) })).rejects.toThrow(UsageError);
    await expect(importUpload(app, { board: "zsa/moonlander", filename: "a.zip", bytes: new Uint8Array() })).rejects.toThrow(UsageError);
    await expect(importUpload(app, { board: "zsa/moonlander", filename: "a.zip", bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow(UsageError);
    await expect(importUpload(app, { board: "no/board", filename: "a.zip", bytes: new Uint8Array([1]) })).rejects.toThrow(NotFoundError);
    expect(listLayouts(app)).toEqual([]);
    closeApp(app);
  });
});

describe("safeFilename", () => {
  test("keeps the extension, drops directories and odd characters", () => {
    expect(safeFilename("../../etc/My Layout (1).KEYMAP")).toBe("My_Layout_1_.keymap");
    expect(safeFilename("C:\\Users\\bk\\export.zip")).toBe("export.zip");
    expect(safeFilename("Export.ZIP")).toBe("Export.zip");
    expect(() => safeFilename("..")).toThrow(UsageError);
    expect(() => safeFilename("layout")).toThrow(UsageError);
  });
});
