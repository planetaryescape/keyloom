import { describe, expect, test } from "bun:test";
import { ElfError, definedSymbols } from "../../../src/firmware/toolchain/elf.ts";
import { fakeElf } from "../../helpers/fake-elf.ts";

describe("definedSymbols", () => {
  test("lists the symbols the ELF defines and leaves out the ones it only references", () => {
    const symbols = definedSymbols(fakeElf(["__wrap_raw_hid_receive", "main"], ["__real_raw_hid_receive"]));
    expect(symbols.has("__wrap_raw_hid_receive")).toBe(true);
    expect(symbols.has("main")).toBe(true);
    expect(symbols.has("__real_raw_hid_receive")).toBe(false);
    expect(symbols.has("raw_hid_receive")).toBe(false);
  });

  test("refuses a file that is not a 32-bit little-endian ELF", () => {
    expect(() => definedSymbols(new TextEncoder().encode("not an elf, but longer than a header".repeat(3)))).toThrow(ElfError);
    const big = fakeElf(["x"]);
    big[4] = 2; // ELFCLASS64
    expect(() => definedSymbols(big)).toThrow("32-bit");
  });

  test("refuses a file whose section table runs past its end instead of reading garbage", () => {
    const cut = fakeElf(["x"]).slice(0, 80);
    expect(() => definedSymbols(cut)).toThrow(ElfError);
  });
});
