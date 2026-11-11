// R5-02: the lines that say a firmware doesn't fit, read from what the toolchains print (test/fixtures/build-logs/README.md).
import { expect, test } from "bun:test";
import { join } from "node:path";
import { firmwareOverflow, tooLargeMessage } from "../../../src/firmware/toolchain/build-failure.ts";
import { generatedSourceError } from "../../../src/firmware/qmk/locate-error.ts";

const log = async (name: string) => (await Bun.file(join(import.meta.dir, "../../fixtures/build-logs", name)).text()).split("\n");

test("GNU ld's overflow gives the bytes; its 'will not fit' alone says only that it doesn't fit", async () => {
  expect(firmwareOverflow(await log("ld-region-overflow.log"))).toEqual({ bytes: 228 });
  expect(firmwareOverflow(["ld: a2.elf section `.data' will not fit in region `FLASH'"])).toEqual({ bytes: null });
});

test("QMK's AVR size check is read through its colour codes", async () => {
  expect(firmwareOverflow(await log("qmk-avr-too-large.log"))).toEqual({ bytes: 262 });
});

test("a compile error or a full disk is not an overflow", async () => {
  expect(firmwareOverflow(await log("qmk-unknown-keycode.log"))).toBeNull();
  expect(firmwareOverflow(await log("zmk-docker-disk-full.log"))).toBeNull();
});

test("the message names the board and the bytes", () => {
  expect(tooLargeMessage("Glove80", { bytes: 1 })).toBe("The firmware is too big for the Glove80's memory by 1 byte. Fewer combos, macros or features make it smaller.");
  expect(tooLargeMessage("Glove80", { bytes: null })).toBe("The firmware is too big for the Glove80's memory. Fewer combos, macros or features make it smaller.");
});

test("a compile error in another generated file names the file, and one outside keyloom's folder is not keyloom's", () => {
  expect(generatedSourceError(["keyboards/zsa/moonlander/keymaps/keyloom/config.h:12:9: error: expected identifier"], "keyloom")).toBe("config.h:12: expected identifier");
  expect(generatedSourceError(["quantum/action.c:3:1: error: bad"], "keyloom")).toBeUndefined();
});
