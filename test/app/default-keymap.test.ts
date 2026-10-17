// A blank config starts from the firmware's default keymap where keyloom can get one (25, D-370), and says why when it can't.
import { describe, expect, test } from "bun:test";
import { getLayout, listRevisions, newBlankConfig, openApp, showBoard } from "../../src/app/index.ts";
import { readDefaultKeymap } from "../../src/app/default-keymap.ts";
import { defaultKeymapTree, emptyTree } from "../helpers/default-keymaps.ts";
import { tempDir } from "../helpers/tmp.ts";

const tree = () => ({ fetchText: defaultKeymapTree(), cacheDir: tempDir() });

describe("the firmware default keymap", () => {
  test("a QMK board's is keymaps/default at its pinned SHA", async () => {
    const urls: string[] = [];
    const found = await readDefaultKeymap(showBoard("zsa/moonlander").definition, { fetchText: defaultKeymapTree(urls), cacheDir: tempDir() });
    expect(urls).toEqual(["https://raw.githubusercontent.com/zsa/qmk_firmware/93b2b9ec3368f86c5eb5a2e3f934049f8daef885/keyboards/zsa/moonlander/keymaps/default/keymap.c"]);
    expect(found.layout?.layers.length).toBeGreaterThan(1);
    expect(found.layout?.boardId).toBe("zsa/moonlander");
  });

  test("a ZMK shield's is its own .keymap, and the Glove80's is MoErgo's template", async () => {
    const corne = await readDefaultKeymap(showBoard("foostan/corne").definition, tree());
    expect(corne.layout?.layers.length).toBeGreaterThan(1);
    const glove = await readDefaultKeymap(showBoard("moergo/glove80").definition, tree());
    expect(glove.layout?.boardId).toBe("moergo/glove80");
    expect(glove.layout && "from" in glove ? glove.from : "").toContain("config/glove80.keymap at 34888be");
  });

  test("it is fetched once and then read from the cache", async () => {
    const cacheDir = tempDir();
    const def = showBoard("zsa/moonlander").definition;
    await readDefaultKeymap(def, { fetchText: defaultKeymapTree(), cacheDir });
    const second = await readDefaultKeymap(def, { fetchText: emptyTree, cacheDir });
    expect(second.layout).not.toBeNull();
  });

  test("a tree without one, and a file that is not this board's, are reasons and not errors", async () => {
    const none = await readDefaultKeymap(showBoard("zsa/moonlander").definition, { fetchText: emptyTree, cacheDir: tempDir() });
    expect(none).toMatchObject({ layout: null });
    expect("reason" in none && none.reason).toMatch(/default keymap.*keymap\.c at 93b2b9e.*404/);
    // The Corne's keymap has 42 keys, so it can't be the Moonlander's.
    const wrong = await readDefaultKeymap(showBoard("zsa/moonlander").definition, {
      fetchText: async () => Bun.file(`${import.meta.dir}/../fixtures/zmk/corne/corne.keymap`).text(), cacheDir: tempDir(),
    });
    expect(wrong.layout).toBeNull();
  });
});

describe("a blank config", () => {
  test("starts from the default keymap, and its first revision says where from", async () => {
    const app = openApp({ dataDir: tempDir() });
    const made = await newBlankConfig(app, { name: "Fresh", board: "zsa/moonlander" }, tree());
    expect(made.started).toBe("default");
    expect(made.note).toContain("default keymap (keyboards/zsa/moonlander/keymaps/default/keymap.c at 93b2b9e)");
    expect(getLayout(app, made.config.id).document.layers.length).toBeGreaterThan(1);
    expect(listRevisions(app, made.config.id)[0]?.summary).toBe(made.note);
  });

  test("falls back to the empty Base layer and says why", async () => {
    const app = openApp({ dataDir: tempDir() });
    const made = await newBlankConfig(app, { name: "Fresh", board: "foostan/corne" }, { fetchText: emptyTree, cacheDir: tempDir() });
    expect(made.started).toBe("empty");
    expect(made.note).toMatch(/no default keymap: couldn't get Corne's default keymap/);
    const doc = getLayout(app, made.config.id).document;
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]?.name).toBe("Base");
    expect(listRevisions(app, made.config.id)[0]?.summary).toBe(made.note);
  });

  test("a software remapper's blank is the identity map, with no lookup", async () => {
    const app = openApp({ dataDir: tempDir() });
    const urls: string[] = [];
    const made = await newBlankConfig(app, { name: "Fresh", board: "apple/macbook-ansi" }, { fetchText: defaultKeymapTree(urls), cacheDir: tempDir() });
    expect(made.started).toBe("empty");
    expect(urls).toEqual([]);
  });

  test("a bad or taken name is refused before anything is fetched", async () => {
    const app = openApp({ dataDir: tempDir() });
    const urls: string[] = [];
    await expect(newBlankConfig(app, { name: " ", board: "zsa/moonlander" }, { fetchText: defaultKeymapTree(urls), cacheDir: tempDir() })).rejects.toThrow(/must not be empty/);
    expect(urls).toEqual([]);
    await newBlankConfig(app, { name: "Fresh", board: "zsa/moonlander" }, tree());
    await expect(newBlankConfig(app, { name: "Fresh", board: "zsa/moonlander" }, tree())).rejects.toThrow(/already exists/);
  });
});
