import { describe, expect, test } from "bun:test";
import { checkBoardDir } from "../../src/boards/check.ts";
import { GeometryError, generateGeometry } from "../../src/boards/geometry.ts";
import { loadDefinitionDir } from "../../src/boards/load.ts";
import { QMK_INFO, ZMK_LAYOUT, fetchFor, templateCopy } from "../helpers/board-recipes.ts";

const errors = (r: Awaited<ReturnType<typeof checkBoardDir>>) => r.issues.filter((i) => i.level === "error").map((i) => i.message);
const check = (dir: string, text: string) => checkBoardDir(dir, { fetchText: fetchFor(text) });

describe("the template boards", () => {
  test("the QMK template passes boards check once geometry is generated", async () => {
    expect(await check(await templateCopy("qmk"), QMK_INFO)).toEqual({ ok: true, issues: [] });
  });

  test("the ZMK template passes boards check once geometry is generated", async () => {
    expect(await check(await templateCopy("zmk"), ZMK_LAYOUT)).toEqual({ ok: true, issues: [] });
  });
});

describe("recipes are strict", () => {
  test("a misspelled recipe field is an error that names it, not a silent default", async () => {
    const dir = await templateCopy("qmk");
    const board = await Bun.file(`${dir}/board.json`).json();
    board.revisions[0].build.layoutMacroo = "LAYOUT";
    await Bun.write(`${dir}/board.json`, JSON.stringify(board));
    const r = await check(dir, QMK_INFO);
    expect(r.ok).toBe(false);
    expect(errors(r).join(" ")).toMatch(/layoutMacroo|layoutMacro/);
  });

  test("an unknown build kind is an error", async () => {
    const dir = await templateCopy("qmk");
    const board = await Bun.file(`${dir}/board.json`).json();
    board.revisions[0].build.kind = "make-it-up";
    await Bun.write(`${dir}/board.json`, JSON.stringify(board));
    const r = await check(dir, QMK_INFO);
    expect(r.ok).toBe(false);
    expect(errors(r).join(" ")).toContain("Invalid discriminator value");
  });

  test("a QMK image must be pinned by digest", async () => {
    const dir = await templateCopy("qmk");
    const board = await Bun.file(`${dir}/board.json`).json();
    board.revisions[0].build.image = "ghcr.io/qmk/qmk_cli:latest";
    await Bun.write(`${dir}/board.json`, JSON.stringify(board));
    expect(errors(await check(dir, QMK_INFO)).join(" ")).toContain("pinned by sha256 digest");
  });
});

describe("recipe rules that span fields", () => {
  test("a ZMK board with a QMK build is an error", async () => {
    const qmk = await Bun.file(`${(await templateCopy("qmk"))}/board.json`).json();
    const dir = await templateCopy("zmk", (b) => {
      b.revisions[0].build = qmk.revisions[0].build;
    });
    expect(errors(await check(dir, ZMK_LAYOUT)).join(" ")).toContain("a ZMK board builds with zmk-moergo-template or zmk-west-docker");
  });

  test("a flash step for a target the build doesn't have is an error", async () => {
    const dir = await templateCopy("zmk", (b) => {
      b.revisions[0].flash.steps[1].target = "rigth";
    });
    const messages = errors(await check(dir, ZMK_LAYOUT));
    expect(messages.join(" ")).toContain('names target "rigth", which the build doesn\'t have');
    expect(messages.join(" ")).toContain('build target "right" has no flash step');
  });

  test("a west build's flash step without a target is an error", async () => {
    const dir = await templateCopy("zmk", (b) => {
      delete b.revisions[0].flash.steps[0].target;
    });
    expect(errors(await check(dir, ZMK_LAYOUT)).join(" ")).toContain("needs a target");
  });

  test("UF2 flashing needs a UF2 build, and Zapp needs a .bin", async () => {
    const uf2 = await templateCopy("qmk", (b) => {
      b.revisions[0].flash = { kind: "uf2-drives", steps: [{ volume: "RPI-RP2", label: "board", enter: "Hold BOOT and plug in." }] };
    });
    expect(errors(await check(uf2, QMK_INFO)).join(" ")).toContain('uf2-drives flashing needs build.artifact "uf2"');
    const zapp = await templateCopy("qmk", (b) => {
      b.revisions[0].flash = { kind: "zapp", bootloader: "0483:df11" };
    });
    expect(errors(await check(zapp, QMK_INFO)).join(" ")).toContain('zapp flashing needs build.artifact "bin"');
  });

  test("a dfu-tool flash needs the artifact its tool writes; the chip and the USB ID follow the tool", async () => {
    const flash = { kind: "dfu-tool", tool: "dfu-programmer", mcu: "atmega32u4", bootloader: "03eb:2ff4", enter: "Press reset." };
    const ok = await check(await templateCopy("qmk", (b) => { b.revisions[0].flash = flash; }), QMK_INFO);
    expect(errors(ok)).toEqual([]);
    const bin = await check(await templateCopy("qmk", (b) => { b.revisions[0].flash = flash; b.revisions[0].build.artifact = "bin"; }), QMK_INFO);
    expect(errors(bin).join("\n")).toContain('dfu-programmer flashing needs build.artifact "hex"');
    const util = await check(await templateCopy("qmk", (b) => { b.revisions[0].flash = { kind: "dfu-tool", tool: "dfu-util", bootloader: "0483:df11", enter: "x" }; }), QMK_INFO);
    expect(errors(util).join("\n")).toContain('dfu-util flashing needs build.artifact "bin"');
    // These two are the schema's own refinements, so the board does not load at all.
    await expect(templateCopy("qmk", (b) => { b.revisions[0].flash = { ...flash, mcu: undefined }; })).rejects.toThrow("need the chip");
    await expect(templateCopy("qmk", (b) => { b.revisions[0].flash = { kind: "dfu-tool", tool: "avrdude", mcu: "atmega32u4", bootloader: "03eb:2ff4", enter: "x" }; })).rejects.toThrow("waits for a serial port");
  });

  test("a ZMK board can't use a dfu-tool flash", async () => {
    const r = await check(await templateCopy("zmk", (b) => { b.revisions[0].flash = { kind: "dfu-tool", tool: "dfu-util", bootloader: "0483:df11", enter: "x" }; }), ZMK_LAYOUT);
    expect(errors(r).join("\n")).toContain("a ZMK board flashes with uf2-drives");
  });

  test("an importer for the other firmware is an error", async () => {
    const dir = await templateCopy("zmk", (b) => {
      b.importers = ["oryx-source"];
    });
    expect(errors(await check(dir, ZMK_LAYOUT)).join(" ")).toContain("reads QMK sources");
  });
});

describe("geometry follows the recipe", () => {
  test("a QMK board's layout is the one its layoutMacro names, read from layoutFile", async () => {
    const dir = await templateCopy("qmk");
    const def = await loadDefinitionDir(dir);
    const two = JSON.stringify({
      layouts: { LAYOUT_other: { layout: [{ x: 9, y: 9 }] }, LAYOUT: { layout: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] } },
    });
    let asked = "";
    const g = await generateGeometry(def, def.revisions[0] as never, { fetchText: async (url) => ((asked = url), two) });
    expect(asked).toContain("/keyboards/vendor/board/info.json");
    expect(g.keys).toHaveLength(4);
  });

  test("a macro that is only an alias resolves through layout_aliases", async () => {
    const dir = await templateCopy("qmk", (b) => {
      b.revisions[0].build.layoutMacro = "LAYOUT_alias";
    });
    const def = await loadDefinitionDir(dir);
    const doc = JSON.stringify({ layout_aliases: { LAYOUT_alias: "LAYOUT_real" }, layouts: { LAYOUT_real: { layout: [{ x: 0, y: 0 }] }, LAYOUT_x: { layout: [] } } });
    const g = await generateGeometry({ ...def, keyCount: 1 }, def.revisions[0] as never, { fetchText: fetchFor(doc) });
    expect(g.keys).toHaveLength(1);
  });

  test("a macro the file doesn't have names what the file does have", async () => {
    const dir = await templateCopy("qmk");
    const def = await loadDefinitionDir(dir);
    const doc = JSON.stringify({ layouts: { A: { layout: [] }, B: { layout: [] } } });
    await expect(generateGeometry(def, def.revisions[0] as never, { fetchText: fetchFor(doc) })).rejects.toThrow(GeometryError);
    await expect(generateGeometry(def, def.revisions[0] as never, { fetchText: fetchFor(doc) })).rejects.toThrow(/found: A, B/);
  });

  test("a west board reads its physical layout from the named file", async () => {
    const dir = await templateCopy("zmk");
    const def = await loadDefinitionDir(dir);
    let asked = "";
    await generateGeometry(def, def.revisions[0] as never, { fetchText: async (url) => ((asked = url), ZMK_LAYOUT) });
    expect(asked).toContain("/app/dts/layouts/vendor/board/layout.dtsi");
  });
});

describe("hands-free recipes map every flash step", () => {
  test("a hands-free half missing for one step is an error, so no step goes unverified", async () => {
    const { Uf2DrivesFlashSchema } = await import("../../src/boards/recipes.ts");
    const board = await Bun.file(`${import.meta.dir}/../../boards/moergo/glove80/board.json`).json();
    const flash = board.revisions[0].flash;
    expect(Uf2DrivesFlashSchema.safeParse(flash).success).toBe(true);
    const partial = { ...flash, handsFree: { ...flash.handsFree, halves: flash.handsFree.halves.slice(0, 1) } };
    const parsed = Uf2DrivesFlashSchema.safeParse(partial);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("every flash step must have a handsFree half");
  });

  test("two hands-free halves on one step, or two steps with one label, are errors", async () => {
    const { Uf2DrivesFlashSchema } = await import("../../src/boards/recipes.ts");
    const board = await Bun.file(`${import.meta.dir}/../../boards/moergo/glove80/board.json`).json();
    const flash = board.revisions[0].flash;
    const [first] = flash.steps;
    const shared = { ...flash, steps: [first], handsFree: { ...flash.handsFree, halves: flash.handsFree.halves.map((h: { step: string }) => ({ ...h, step: first.label })) } };
    expect(JSON.stringify(Uf2DrivesFlashSchema.safeParse(shared).error?.issues)).toContain("each handsFree half must name a different flash step");
    const duplicate = { ...flash, steps: [first, { ...first }] };
    expect(JSON.stringify(Uf2DrivesFlashSchema.safeParse(duplicate).error?.issues)).toContain("flash step labels must be unique");
  });
});
