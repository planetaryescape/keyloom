// What an import card says once the layout is saved and the import has something to tell (R11-01): the Karabiner edit the card promises,
// with the entry to copy, and the importer's warnings. An import with neither opens the layout at once, as before.
import { describe, expect, test } from "bun:test";
import type { ImportResponse } from "../../src/api/http.ts";
import { importedNote } from "../../src/web/import/import-words.ts";
import { KARABINER_IGNORE_ENTRY } from "../../src/firmware/kanata/karabiner.ts";

const result = (over: Partial<ImportResponse> = {}): ImportResponse => ({ layoutId: "lay_1", revisionId: "rev_1", name: "macbook-from-karabiner", layers: 3, keysPerLayer: 77, warnings: [], ...over });

describe("importedNote", () => {
  test("an import with nothing to tell opens at once", () => {
    expect(importedNote(result())).toBeNull();
  });

  test("a Karabiner import shows the entry to add, says keyloom never edits the file, and opens the layout from a button", () => {
    const note = importedNote(result({ karabinerEdit: { entry: KARABINER_IGNORE_ENTRY, unimported: 0 } }));
    expect(note).toMatchObject({ title: "Imported macbook-from-karabiner, 3 layers", open: "Open macbook-from-karabiner", warnings: [] });
    expect(note?.karabiner?.entry).toBe(KARABINER_IGNORE_ENTRY);
    expect(note?.karabiner?.text).toContain("keyloom never edits karabiner.json");
    expect(note?.karabiner?.text).toContain("\"devices\" list");
    expect(note?.karabiner?.unimported).toBeNull();
    // The page names no terminal command as the way on.
    expect(note?.karabiner?.text).not.toMatch(/karabiner_cli|`|keyloom import/);
  });

  test("rules keyloom didn't import are counted, and the warnings that list them show", () => {
    const warnings = ["Not imported, left as it is in Karabiner: Hyper (an entry isn't a plain key to key mapping)"];
    const one = importedNote(result({ warnings, karabinerEdit: { entry: KARABINER_IGNORE_ENTRY, unimported: 1 } }));
    expect(one?.karabiner?.unimported).toBe("1 rule keyloom didn't import stops working on the built-in keyboard once Karabiner leaves it alone. It's listed below.");
    expect(one?.warnings).toEqual(warnings);
    expect(importedNote(result({ karabinerEdit: { entry: KARABINER_IGNORE_ENTRY, unimported: 2 } }))?.karabiner?.unimported).toStartWith("2 rules keyloom didn't import stop working");
  });

  // R12-07: the checklist's Karabiner step has Open Karabiner-Elements; the note offers it too, only where the app is installed.
  test("Open Karabiner-Elements is offered only where the server found the app", () => {
    expect(importedNote(result({ karabinerEdit: { entry: KARABINER_IGNORE_ENTRY, unimported: 0, appInstalled: true } }))?.karabiner?.open).toBe(true);
    expect(importedNote(result({ karabinerEdit: { entry: KARABINER_IGNORE_ENTRY, unimported: 0, appInstalled: false } }))?.karabiner?.open).toBe(false);
    // An older server says nothing, so no button that might open nothing.
    expect(importedNote(result({ karabinerEdit: { entry: KARABINER_IGNORE_ENTRY, unimported: 0 } }))?.karabiner?.open).toBe(false);
  });

  test("another board's warnings show too, with no Karabiner words", () => {
    const note = importedNote(result({ name: "Daily", layers: 1, warnings: ["a warning"] }));
    expect(note).toMatchObject({ title: "Imported Daily, 1 layer", karabiner: null, warnings: ["a warning"], open: "Open Daily" });
  });
});
