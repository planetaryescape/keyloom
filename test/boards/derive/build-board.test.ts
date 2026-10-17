// The board definition assembled from a candidate, geometry and the person's confirmations (22#building-the-board-definition), and the
// flash recipe each bootloader gets. Every derived definition goes through `boards check`, offline, as a contributed one does.
import { describe, expect, test } from "bun:test";
import { DeriveError, deriveBoard, localBoardId } from "../../../src/boards/derive/build-board.ts";
import { type Candidate } from "../../../src/boards/derive/detect.ts";
import { qmkFlash, targetId, zmkFlash } from "../../../src/boards/derive/flash-recipe.ts";
import { checkBoardDir } from "../../../src/boards/check.ts";
import type { QmkEntry } from "../../../src/boards/derive/index-schema.ts";
import { keyboardIndex } from "../../../src/boards/derive/keyboard-index.ts";
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

  test("atmel-dfu, stm32-dfu and caterina run their tool, with the chip the tool is told about and the bootloader's USB ID", () => {
    expect(qmkFlash("atmel-dfu", undefined, "atmega32u4")).toMatchObject({ artifact: "hex", flash: { kind: "dfu-tool", tool: "dfu-programmer", mcu: "atmega32u4", bootloader: "03eb:2ff4" } });
    expect(qmkFlash("atmel-dfu", undefined, "atmega32u2").flash).toMatchObject({ bootloader: "03eb:2ff0" });
    expect(qmkFlash("stm32-dfu", undefined, "STM32F303")).toMatchObject({ artifact: "bin", flash: { kind: "dfu-tool", tool: "dfu-util", bootloader: "0483:df11" } });
    const caterina = qmkFlash("caterina", undefined, "atmega32u4");
    expect(caterina).toMatchObject({ artifact: "hex", flash: { kind: "dfu-tool", tool: "avrdude", mcu: "atmega32u4" } });
    expect(caterina.flash).not.toHaveProperty("bootloader");
    expect(caterina.manualReason).toBeUndefined();
  });

  test("every atmel-dfu, stm32-dfu and caterina keyboard in the pinned index gets a recipe keyloom runs", () => {
    const wanted = keyboardIndex().qmk.filter((e) => e.bootloader === "atmel-dfu" || e.bootloader === "stm32-dfu" || e.bootloader === "caterina");
    expect(wanted.length).toBeGreaterThan(2500);
    const manual = wanted.filter((e) => qmkFlash(e.bootloader, e.bootInstructions, e.processor).flash.kind === "manual").map((e) => `${e.target} (${e.bootloader}, ${e.processor})`);
    expect(manual).toEqual([]);
  });

  test("a DFU bootloader whose chip is missing or unknown stays manual, and says why", () => {
    expect(qmkFlash("atmel-dfu").manualReason).toContain("which chip");
    expect(qmkFlash("caterina").flash.kind).toBe("manual");
    expect(qmkFlash("atmel-dfu", undefined, "atmega99x9").manualReason).toContain("atmega99x9");
  });

  test("every other bootloader is manual, with the reason and the tool QMK's guide names", () => {
    for (const [bootloader, tool, artifact] of [["halfkay", "Teensy", "hex"], ["usbasploader", "avrdude", "hex"], ["wb32-dfu", "wb32-dfu-updater", "bin"]] as const) {
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
    expect(qmkFlash("halfkay", "Hold Escape while plugging in.").flash).toMatchObject({ kind: "manual", instructions: expect.stringMatching(/^Hold Escape while plugging in\./) });
    expect(qmkFlash("atmel-dfu", "Hold Escape while plugging in.", "atmega32u4").flash).toMatchObject({ kind: "dfu-tool", enter: "Hold Escape while plugging in." });
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

  test("a Pro Micro board (caterina) flashes with avrdude, has no manual reason, and AVR builds take LUFA", async () => {
    const derived = deriveBoard({ candidate: qmkCandidate({ bootloader: "caterina", processor: "atmega32u4" }), geometry: { keys, path: "keyboards/handwired/pico_split/keyboard.json" }, homeRow: 2, layout: "LAYOUT" });
    expect(derived.definition.revisions[0]?.flash).toMatchObject({ kind: "dfu-tool", tool: "avrdude" });
    expect(derived.summary.manualFlashReason).toBeNull();
    expect(derived.definition.revisions[0]?.build).toMatchObject({ submodules: ["lib/lufa"], artifact: "hex" });
    expect((await check(derived)).ok).toBe(true);
  });

  test("an stm32-dfu board builds with ChibiOS and LUFA's USB headers (S43), and a chip-less atmel-dfu board stays manual", async () => {
    const stm = deriveBoard({ candidate: qmkCandidate({ bootloader: "stm32-dfu", processor: "STM32F303" }), geometry: { keys, path: "p" }, homeRow: 2, layout: "LAYOUT" });
    expect(stm.definition.revisions[0]?.build).toMatchObject({ submodules: ["lib/chibios", "lib/chibios-contrib", "lib/printf", "lib/lufa"], artifact: "bin" });
    expect(stm.definition.revisions[0]?.flash).toMatchObject({ kind: "dfu-tool", tool: "dfu-util" });
    expect((await check(stm)).ok).toBe(true);
    const bare = deriveBoard({ candidate: qmkCandidate({ bootloader: "atmel-dfu" }), geometry: { keys, path: "p" }, homeRow: 2, layout: "LAYOUT" });
    expect(bare.definition.revisions[0]?.flash.kind).toBe("manual");
    expect(bare.summary.manualFlashReason).toContain("which chip");
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
