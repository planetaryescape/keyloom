// `keyboard add` for QMK keyboards and the refusals (22#building-the-board-definition). The pinned QMK tree is replaced by fixtures
// copied from it, so nothing here reads the network.
import { afterAll, describe, expect, test } from "bun:test";
import { type AddDeps, addKeyboard, openApp, previewKeyboard, showBoard } from "../../src/app/index.ts";
import { GeometryError } from "../../src/boards/geometry-error.ts";
import { loadBoardDir } from "../../src/boards/load.ts";
import { listBoards, setUserBoards } from "../../src/boards/registry.ts";
import { readUserBoards } from "../../src/boards/user-boards.ts";
import { CORNE_DIR, MOONLANDER_INFO_FIXTURE } from "../helpers/derive-sources.ts";
import { MOONLANDER_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

const fixtures = `${import.meta.dir}/../fixtures/qmk`;
const QMK_FILES: Record<string, string> = {
  "keyboards/zsa/moonlander/keyboard.json": MOONLANDER_INFO_FIXTURE,
  "keyboards/crkbd/info.json": `${fixtures}/crkbd/info.json`,
  "keyboards/crkbd/rev1/keyboard.json": `${fixtures}/crkbd/rev1/keyboard.json`,
};
const tree = async (url: string): Promise<string> => {
  const file = QMK_FILES[url.replace(/^.*\/7a1bbf37c5c07da4ea0a162bb139083a46ef40a1\//, "")];
  if (file === undefined) throw new GeometryError(`GET ${url} returned 404`);
  return Bun.file(file).text();
};
const deps = (): AddDeps => ({ fetchText: tree, cacheDir: tempDir() });
const world = () => ({ app: openApp({ dataDir: tempDir() }), deps: deps() });

// Derived boards live in the registry of this process; leave it as other test files expect it.
afterAll(() => setUserBoards([]));

describe("a QMK keyboard", () => {
  test("a Moonlander derives to BK's committed hands, thumbs, fingers, rows and mirror, with a dfu-util flash for stm32-dfu", async () => {
    const { app, deps: d } = world();
    const out = await addKeyboard(app, { candidate: "qmk:zsa/moonlander", homeRow: 3 }, { ...d, boards: [] });
    expect(out.boardId).toBe("local/zsa-moonlander");
    const derived = showBoard(out.boardId).definition;
    const committed = (await loadBoardDir(MOONLANDER_DIR)).definition;
    expect(derived.hands).toEqual(committed.hands);
    expect(derived.fingers).toEqual(committed.fingers);
    expect(derived.mirror).toEqual(committed.mirror);
    // The committed file files two thumb keys in its `lower` row; the finger table calls them thumbs, and so does the derived one.
    expect(derived.rows.thumb).toEqual(Object.entries(committed.fingers).filter(([, f]) => f.endsWith("thumb")).map(([p]) => Number(p)));
    const rev = derived.revisions[0]!;
    expect(rev.qmkTarget).toBe("zsa/moonlander");
    expect(rev.detect).toEqual({ usbProductId: "0x1969", usbVendorId: "0x3297" });
    expect(rev.build).toMatchObject({ kind: "qmk-docker", layoutMacro: "LAYOUT", layoutFile: "keyboards/zsa/moonlander/keyboard.json", artifact: "bin" });
    // Zapp is ZSA's own flasher for ZSA's own fork; a derived board is mainline QMK, so it is flashed with dfu-util.
    expect(rev.flash).toMatchObject({ kind: "dfu-tool", tool: "dfu-util", bootloader: "0483:df11" });
    expect(out.derived.manualFlashReason).toBeNull();
  });

  test("a Corne walks QMK's info.json chain, takes the alias for its layout, and stores two files where the shipped boards live", async () => {
    const { app, deps: d } = world();
    const out = await addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 2 }, { ...d, boards: [] });
    const derived = showBoard(out.boardId).definition;
    expect(derived.keyCount).toBe(42);
    expect(derived.revisions[0]?.build).toMatchObject({ layoutMacro: "LAYOUT_split_3x6_3", layoutFile: "keyboards/crkbd/info.json", artifact: "hex" });
    expect(derived.revisions[0]?.flash).toMatchObject({ kind: "dfu-tool", tool: "avrdude", mcu: "atmega32u4" });
    expect(out.derived.manualFlashReason).toBeNull();
    const committed = (await loadBoardDir(CORNE_DIR)).definition;
    expect(derived.hands).toEqual(committed.hands);
    expect(derived.fingers).toEqual(committed.fingers);
    // A second process finds it in the data directory, beside the boards keyloom ships.
    const found = readUserBoards(app.dataDir);
    expect(found.problems).toEqual([]);
    expect(found.boards.map((b) => b.definition.id)).toEqual(["local/crkbd-rev1"]);
    expect(listBoards().map((b) => b.definition.id)).toEqual(expect.arrayContaining(["zsa/moonlander", "local/crkbd-rev1"]));
  });

  test("a layout the keyboard does not have is refused with the choices", async () => {
    const { app, deps: d } = world();
    await expect(addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 2, layout: "LAYOUT_nope" }, { ...d, boards: [] })).rejects.toThrow(/LAYOUT_split_3x5_3 \(36 keys\), LAYOUT_split_3x6_3 \(42 keys\)/);
  });

  test("an unknown id, a missing home row and a row out of range are usage errors that name the fix", async () => {
    const { app, deps: d } = world();
    await expect(addKeyboard(app, { candidate: "qmk:no/such" }, d)).rejects.toThrow(/keyboard detect/);
    await expect(addKeyboard(app, { candidate: "qmk:crkbd/rev1" }, { ...d, boards: [] })).rejects.toThrow(/--home-row/);
    await expect(addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 9 }, { ...d, boards: [] })).rejects.toThrow(/1 to 3/);
    await expect(addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 2 }, { ...d, boards: [] })).resolves.toBeDefined();
  });

  test("a board already derived is not derived twice without --force", async () => {
    const { app, deps: d } = world();
    await addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 2 }, { ...d, boards: [] });
    await expect(addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 2 }, d)).rejects.toThrow(/already a board: local\/crkbd-rev1/);
    await expect(addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 3, force: true }, d)).resolves.toMatchObject({ boardId: "local/crkbd-rev1" });
  });

  test("a keyloom board of the same keyboard is named, so nothing is derived over it", async () => {
    const { app, deps: d } = world();
    await expect(addKeyboard(app, { candidate: "zmk:corne", homeRow: 2, controller: "nice_nano//zmk" }, d)).rejects.toThrow(/already a board: foostan\/corne/);
  });

  // R6-07: the preview says so first, with the board, so the page offers to put a config on it instead of drawing it as new.
  test("a preview of a keyboard keyloom has is refused with board_known and the board, before anything is read", async () => {
    let reads = 0;
    const counting = async (url: string) => {
      reads += 1;
      return tree(url);
    };
    const refused = previewKeyboard({ candidate: "zmk:corne" }, { fetchText: counting, cacheDir: tempDir() });
    await expect(refused).rejects.toMatchObject({ name: "KeyboardAddError", code: "board_known", board: "foostan/corne" });
    expect(reads).toBe(0);
  });

  test("a board derived before can be previewed again with force, as `keyboard add --force` does", async () => {
    const { app, deps: d } = world();
    await addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 2 }, { ...d, boards: [] });
    const known = { ...d, boards: listBoards().filter((b) => b.definition.id === "local/crkbd-rev1") };
    await expect(previewKeyboard({ candidate: "qmk:crkbd/rev1" }, known)).rejects.toMatchObject({ code: "board_known", board: "local/crkbd-rev1" });
    await expect(previewKeyboard({ candidate: "qmk:crkbd/rev1", force: true }, known)).resolves.toMatchObject({ candidate: { id: "qmk:crkbd/rev1" } });
  });

  // R6-14: a layout file that isn't one is a code the page answers with the contribution guide; it never names keyloom's cache.
  test("a layout file keyloom can't read is refused with layout_unreadable", async () => {
    const garbled = async (url: string) => (url.endsWith("keyboards/crkbd/rev1/keyboard.json") ? "{ not json" : tree(url));
    const refused = previewKeyboard({ candidate: "qmk:crkbd/rev1" }, { fetchText: garbled, cacheDir: tempDir(), boards: [] });
    await expect(refused).rejects.toMatchObject({ name: "KeyboardAddError", code: "layout_unreadable" });
    await expect(refused).rejects.not.toThrow(/cache/);
  });

  test("a network failure is reported as one, not as a bug", async () => {
    const { app } = world();
    const offline = async () => {
      throw new Error("fetch failed");
    };
    // GitHub not answering is a code the page offers Try again for (R6-14), with the CLI's words and the cause in the message.
    const refused = addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 2 }, { fetchText: offline, cacheDir: tempDir(), boards: [] });
    await expect(refused).rejects.toMatchObject({ name: "KeyboardAddError", code: "firmware_unreachable" });
    await expect(refused).rejects.toThrow("fetch failed");
  });

  test("the preview lists the rows and what is still needed", async () => {
    const p = await previewKeyboard({ candidate: "qmk:zsa/moonlander" }, { ...deps(), boards: [] });
    expect(p.layout).toBe("LAYOUT");
    expect(p.rows.map((r) => r.keys)).toEqual([14, 14, 14, 12, 10]);
    expect(p.guessedHomeRow).toBe(3);
    expect(p.needs).toEqual(["--home-row"]);
  });
});

// R5-06: a keyboard keyloom can't add yet says so with a code, and a QMK keyboard with several layouts and no default is drawn on a guess
// with the layouts to pick from, instead of ending at "choose one with --layout".
describe("what the new-keyboard screen is told", () => {
  const grid = (rows: number[]) => rows.flatMap((n, y) => Array.from({ length: n }, (_, x) => ({ x, y, matrix: [y, x] })));
  // Atomic: two layouts in QMK's index (66 and 75 keys) and neither is LAYOUT, so there is no default. Synthetic keys, the index's counts.
  const atomic = JSON.stringify({ layouts: { LAYOUT_semi_standard: { layout: grid([14, 14, 13, 13, 12]) }, LAYOUT_ortho_5x15: { layout: grid([15, 15, 15, 15, 15]) } } });
  const zmkTree = async (url: string): Promise<string> => {
    // The MakerDiary m60's layout file, from the Corne fixture under the m60's label: only its keys matter here.
    if (url.endsWith("/app/dts/layouts/common/60percent/ansi.dtsi")) return (await Bun.file(`${import.meta.dir}/../fixtures/zmk/corne-physical-layout/6column.dtsi`).text()).replace(/foostan_corne_6col_layout:/, "layout_60_ansi:");
    if (url.endsWith("/keyboards/atomic/keyboard.json")) return atomic;
    throw new GeometryError(`GET ${url} returned 404`);
  };
  const d = (): AddDeps => ({ fetchText: zmkTree, cacheDir: tempDir() });

  test("a QMK keyboard with several layouts and no default is drawn on the one with most keys, lists them all, and needs --layout", async () => {
    const p = await previewKeyboard({ candidate: "qmk:atomic" }, d());
    expect(p.layout).toBe("LAYOUT_ortho_5x15");
    expect(p.keyCount).toBe(75);
    expect(p.layouts).toEqual([{ name: "LAYOUT_semi_standard", keys: 66 }, { name: "LAYOUT_ortho_5x15", keys: 75 }]);
    expect(p.needs).toEqual(["--home-row", "--layout"]);
    expect(p.guessedLayout).toBe("LAYOUT_ortho_5x15");
    expect(p.board).not.toBeNull();
    const picked = await previewKeyboard({ candidate: "qmk:atomic", layout: "LAYOUT_semi_standard" }, d());
    expect(picked.keyCount).toBe(66);
    expect(picked.needs).toEqual(["--home-row"]);
    // The guess is still named after a pick, so the page keeps it marked (#293 review).
    expect(picked.guessedLayout).toBe("LAYOUT_ortho_5x15");
  });

  test("add still asks the CLI for --layout rather than storing keyloom's guess", async () => {
    const { app } = world();
    await expect(addKeyboard(app, { candidate: "qmk:atomic", homeRow: 3 }, { ...d(), boards: [] })).rejects.toThrow(/choose one with --layout/);
    const out = await addKeyboard(app, { candidate: "qmk:atomic", homeRow: 3, layout: "LAYOUT_semi_standard" }, { ...d(), boards: [] });
    expect(out.boardId).toBe("local/atomic");
  });

  test("a shield no controller keyloom knows fits is drawn, with controller_unknown and no board", async () => {
    const p = await previewKeyboard({ candidate: "zmk:m60" }, d());
    expect(p.controllers).toEqual([]);
    expect(p.board).toBeNull();
    expect(p.boardProblemCode).toBe("controller_unknown");
    expect(p.boardProblem).toContain("--controller");
  });

  test("a keyboard whose firmware tree has no key positions is refused with no_key_positions, by preview and add alike", async () => {
    const { app } = world();
    const refusal = { name: "KeyboardAddError", code: "no_key_positions" };
    // keyloom ships a Glove80, so the preview would say board_known first (R6-07); without it, the firmware tree's answer shows.
    await expect(previewKeyboard({ candidate: "zmk:glove80" }, { ...d(), boards: [] })).rejects.toMatchObject(refusal);
    await expect(addKeyboard(app, { candidate: "zmk:glove80", homeRow: 2 }, { ...d(), boards: [] })).rejects.toMatchObject(refusal);
  });

  test("a home row the board doesn't have is refused by add with the derive code", async () => {
    const { app } = world();
    await expect(addKeyboard(app, { candidate: "qmk:atomic", homeRow: 9, layout: "LAYOUT_semi_standard" }, { ...d(), boards: [] }))
      .rejects.toMatchObject({ name: "KeyboardAddError", code: "home_row_out_of_range" });
  });
});
