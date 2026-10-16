// The board definition assembled from a candidate, geometry and the person's confirmations (22#building-the-board-definition), and the
// flash recipe each bootloader gets. Every derived definition goes through `boards check`, offline, as a contributed one does.
import { describe, expect, test } from "bun:test";
import { DeriveError, deriveBoard, localBoardId } from "../../../src/boards/derive/build-board.ts";
import { type Candidate } from "../../../src/boards/derive/detect.ts";
import { qmkFlash, targetId, zmkFlash } from "../../../src/boards/derive/flash-recipe.ts";
import { checkBoardDir } from "../../../src/boards/check.ts";
import type { QmkEntry } from "../../../src/boards/derive/index-schema.ts";
import { writeUserBoard } from "../../../src/boards/user-boards.ts";
import { sourceBoards } from "../../helpers/derive-sources.ts";
import { tempDir } from "../../helpers/tmp.ts";

const [, , corne] = await sourceBoards();
const keys = corne!.keys;

const qmkEntry = (over: Partial<QmkEntry>): QmkEntry => ({ target: "handwired/pico_split", name: "Pico Split", vid: "0xfeed", pid: "0x6060", split: true, layouts: { LAYOUT: 42 }, ...over });
const qmkCandidate = (over: Partial<QmkEntry>): Candidate => {
  const qmk = qmkEntry(over);
  return { id: `qmk:${qmk.target}`, firmware: "qmk", name: qmk.name, vendor: "handwired", confidence: 1, reasons: [], entry: { kind: "qmk", qmk } };
};

async function check(derived: ReturnType<typeof deriveBoard>) {
  const dir = writeUserBoard(tempDir(), derived);
  return checkBoardDir(dir, { offline: true });
}

describe("flash recipes by bootloader", () => {
  test("rp2040 is the one QMK bootloader whose boot drive keyloom knows, and gives a UF2 recipe", () => {
    const out = qmkFlash("rp2040");
    expect(out.artifact).toBe("uf2");
    expect(out.flash).toMatchObject({ kind: "uf2-drives", steps: [{ volume: "RPI-RP2" }] });
    expect(out.manualReason).toBeUndefined();
  });

  test("every other bootloader is manual, with the reason and the tool QMK's guide names", () => {
    for (const [bootloader, tool, artifact] of [["atmel-dfu", "dfu-programmer", "hex"], ["stm32-dfu", "dfu-util", "bin"], ["caterina", "avrdude", "hex"], ["halfkay", "Teensy", "hex"]] as const) {
      const out = qmkFlash(bootloader);
      expect(out.flash.kind).toBe("manual");
      expect(out.flash.kind === "manual" && out.flash.instructions).toContain(tool);
      expect(out.manualReason).toContain(bootloader);
      expect(out.artifact).toBe(artifact);
    }
  });

  test("tinyuf2 and uf2boot are manual because their drive names are not known, and an unknown bootloader says so", () => {
    expect(qmkFlash("tinyuf2").manualReason).toContain("boot drive");
    expect(qmkFlash(undefined).manualReason).toContain("doesn't say");
  });

  test("the maintainer's own words about reaching the bootloader come first", () => {
    const out = qmkFlash("atmel-dfu", "Hold Escape while plugging in.");
    expect(out.flash.kind === "manual" && out.flash.instructions.startsWith("Hold Escape while plugging in.")).toBe(true);
  });

  test("a ZMK controller keyloom knows the boot drive of gets one UF2 step per half; others are refused", () => {
    expect(zmkFlash("nice_nano//zmk", ["corne_left", "corne_right"])).toMatchObject({
      kind: "uf2-drives",
      steps: [{ volume: "NICENANO", label: "left half", target: "left" }, { volume: "NICENANO", label: "right half", target: "right" }],
    });
    expect(zmkFlash("seeeduino_xiao//zmk", ["a"])).toBeUndefined();
    expect(targetId("glove80_lh")).toBe("left");
    expect(targetId("planck")).toBe("planck");
  });
});

describe("deriveBoard", () => {
  test("an RP2040 board passes boards check with a UF2 flash and the vendor and product ID it was found by", async () => {
    const derived = deriveBoard({
      candidate: qmkCandidate({ bootloader: "rp2040" }), geometry: { keys, path: "keyboards/handwired/pico_split/keyboard.json" }, homeRow: 2, layout: "LAYOUT",
    });
    expect(derived.definition.id).toBe("local/handwired-pico-split");
    expect(derived.definition.revisions[0]).toMatchObject({ detect: { usbProductId: "0x6060", usbVendorId: "0xfeed" }, flash: { kind: "uf2-drives" }, build: { artifact: "uf2" } });
    const build = derived.definition.revisions[0]?.build;
    expect(build?.kind === "qmk-docker" && build.submodules).toContain("lib/pico-sdk");
    expect(derived.summary.manualFlashReason).toBeNull();
    const result = await check(derived);
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  test("a Pro Micro board (caterina) is manual and AVR builds take LUFA", async () => {
    const derived = deriveBoard({ candidate: qmkCandidate({ bootloader: "caterina" }), geometry: { keys, path: "keyboards/handwired/pico_split/keyboard.json" }, homeRow: 2, layout: "LAYOUT" });
    expect(derived.definition.revisions[0]?.flash.kind).toBe("manual");
    expect(derived.definition.revisions[0]?.build).toMatchObject({ submodules: ["lib/lufa"], artifact: "hex" });
    expect((await check(derived)).ok).toBe(true);
  });

  test("the home row names the rows around it", () => {
    const at = (homeRow: number) => deriveBoard({ candidate: qmkCandidate({}), geometry: { keys, path: "p" }, homeRow, layout: "LAYOUT" }).summary.rows.map((r) => r.name);
    expect(at(2)).toEqual(["top", "home", "bottom"]);
    expect(at(1)).toEqual(["home", "bottom", "lower"]);
    expect(at(3)).toEqual(["number", "top", "home"]);
  });

  test("a home row outside the block and a missing layout macro are refused", () => {
    expect(() => deriveBoard({ candidate: qmkCandidate({}), geometry: { keys, path: "p" }, homeRow: 4, layout: "LAYOUT" })).toThrow(DeriveError);
    expect(() => deriveBoard({ candidate: qmkCandidate({}), geometry: { keys, path: "p" }, homeRow: 2 })).toThrow(/layout macro/);
  });

  test("the id keeps a derived board apart from the ones keyloom ships", () => {
    expect(localBoardId(qmkCandidate({ target: "crkbd/rev1" }))).toBe("local/crkbd-rev1");
    expect(localBoardId(qmkCandidate({ target: "Keychron/Q1 Pro" }))).toBe("local/keychron-q1-pro");
  });
});
