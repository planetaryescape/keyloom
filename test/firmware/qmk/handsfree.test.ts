import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateQmkSource, GenerateError } from "../../../src/firmware/qmk/generate.ts";
import { importOryxSource } from "../../../src/firmware/qmk/import.ts";
import {
  BOOTLOADER_COMMAND, BOOTLOADER_MAGIC, RAW_HID_REPORT_SIZE, WRAPPER_SYMBOL, bootloaderPacket, buildMarker, markerInFirmware, markerOf, serialIsBuild, wrapperSource,
} from "../../../src/firmware/qmk/handsfree.ts";
import { FIXTURE_DIR, moonlander } from "../../helpers/board.ts";
import { SLOW_RUNNER_MS } from "../../helpers/timeouts.ts";

const BUILD = "bld_01JABCDEFGHJKMNPQRSTVWXYZ0";
const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
const files = (handsFree?: { buildId: string }) => {
  const g = generateQmkSource({ layout, board: board.definition, revisionId: "rev_T", boardRevisionId: "reva", ...(handsFree ? { handsFree } : {}) });
  return { g, get: (n: string) => g.files.find((f) => f.path === n)?.content ?? "" };
};

describe("the build marker", () => {
  test("is keyloom/ plus the random end of the build ID, short enough for Oryx's firmware-version reply", () => {
    const marker = buildMarker(BUILD);
    expect(marker).toBe("keyloom/NPQRSTVWXYZ0");
    // oryx.c copies sizeof(SERIAL_NUMBER) bytes after a type byte into one 32-byte report, with a stop byte after.
    expect(marker.length + 1 + 1 + 1).toBeLessThanOrEqual(RAW_HID_REPORT_SIZE);
  });

  test("two builds in the same millisecond get different markers", () => {
    expect(buildMarker("bld_01JABCDEFGHJKMNPQRSTVWXYZ0")).not.toBe(buildMarker("bld_01JABCDEFGHJKMNPQRSTVWXYZ1"));
  });

  test("a string that isn't a build ID is refused, so a typo can't produce a marker that no build carries", () => {
    expect(() => buildMarker("bld_test")).toThrow("isn't a build ID");
    expect(() => buildMarker("01JABCDEFGHJKMNPQRSTVWXYZ0lower")).toThrow();
  });

  test("markerOf separates keyloom's serials from Oryx's, and serialIsBuild is exact", () => {
    expect(markerOf("keyloom/NPQRSTVWXYZ0")).toBe("keyloom/NPQRSTVWXYZ0");
    expect(markerOf("QxKPz/zLQ3Md")).toBeUndefined();
    expect(markerOf(undefined)).toBeUndefined();
    expect(markerOf("keyloom/short")).toBeUndefined();
    expect(markerOf("xkeyloom/NPQRSTVWXYZ0")).toBeUndefined();
    expect(serialIsBuild("keyloom/NPQRSTVWXYZ0", BUILD)).toBe(true);
    expect(serialIsBuild("keyloom/NPQRSTVWXYZ1", BUILD)).toBe(false);
  });

  test("is found in a firmware file the way Oryx's version reply stores it", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("\0\0QxKPz\0"), ...new TextEncoder().encode("keyloom/NPQRSTVWXYZ0"), 0, 1, 2]);
    expect(markerInFirmware(bytes)).toBe("keyloom/NPQRSTVWXYZ0");
    expect(markerInFirmware(new TextEncoder().encode("QxKPz/zLQ3Md"))).toBeUndefined();
  });
});

describe("the bootloader packet", () => {
  test("is one 32-byte report: the command byte, the magic, then zeros", () => {
    const p = bootloaderPacket();
    expect(p.length).toBe(RAW_HID_REPORT_SIZE);
    expect(p[0]).toBe(BOOTLOADER_COMMAND);
    expect(new TextDecoder().decode(p.subarray(1, 1 + BOOTLOADER_MAGIC.length))).toBe(BOOTLOADER_MAGIC);
    expect([...p.subarray(1 + BOOTLOADER_MAGIC.length)].every((b) => b === 0)).toBe(true);
  });

  test("its command byte is not one Oryx or VIA answers to", () => {
    // oryx.h: commands 0x00-0x0C and 0xFE; via.h: 0x01-0x15 and 0xFF. A collision would also trigger that command.
    expect(BOOTLOADER_COMMAND).toBeGreaterThan(0x15);
    expect([0xfe, 0xff]).not.toContain(BOOTLOADER_COMMAND);
  });
});

// The C is compiled and run, because a wrong comparison here would either reboot a keyboard on a stray packet or never reboot it.
const cc = Bun.which("cc") ?? Bun.which("gcc") ?? Bun.which("clang");
describe.skipIf(!cc)("the firmware wrapper, compiled for the host", () => {
  const dir = mkdtempSync(join(tmpdir(), "keyloom-wrap-"));
  const harness = `
#include <stdint.h>
#include <stdio.h>
#include <string.h>
static int resets = 0, forwarded = 0;
void reset_keyboard(void) { resets++; }
void __real_raw_hid_receive(uint8_t *data, uint8_t length);
${wrapperSource().split("\n").filter((l) => !l.startsWith("#include <string.h>") && !l.startsWith("void __real_raw_hid_receive(uint8_t *data, uint8_t length);")).join("\n")}
void __real_raw_hid_receive(uint8_t *data, uint8_t length) { (void)data; (void)length; forwarded++; }
int main(int argc, char **argv) {
  uint8_t buf[32] = {0};
  FILE *f = fopen(argv[1], "rb");
  unsigned n = fread(buf, 1, 32, f);
  fclose(f);
  __wrap_raw_hid_receive(buf, (uint8_t)(argc > 2 ? atoi(argv[2]) : n));
  printf("%d %d\\n", resets, forwarded);
  return 0;
}`;
  writeFileSync(join(dir, "harness.c"), harness.replace("#include <stdio.h>", "#include <stdio.h>\n#include <stdlib.h>"));

  async function build() {
    const r = await Bun.$`${cc} -Wall -Werror -o ${join(dir, "harness")} ${join(dir, "harness.c")}`.quiet().nothrow();
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  }
  const run = async (packet: Uint8Array, length?: number) => {
    const file = join(dir, "packet.bin");
    writeFileSync(file, packet);
    const out = await Bun.$`${join(dir, "harness")} ${file} ${length === undefined ? [] : [String(length)]}`.quiet().text();
    const [resets, forwarded] = out.trim().split(" ").map(Number);
    return { resets, forwarded };
  };

  test("the right packet resets the keyboard and is not passed on", async () => {
    await build();
    expect(await run(bootloaderPacket())).toEqual({ resets: 1, forwarded: 0 });
  }, SLOW_RUNNER_MS);

  test("anything else is passed to Oryx and resets nothing", async () => {
    const wrongMagic = bootloaderPacket();
    wrongMagic[8] = (wrongMagic[8] as number) ^ 1;
    const wrongCommand = bootloaderPacket();
    wrongCommand[0] = 0x01;
    expect(await run(wrongMagic)).toEqual({ resets: 0, forwarded: 1 });
    expect(await run(wrongCommand)).toEqual({ resets: 0, forwarded: 1 });
    expect(await run(new Uint8Array(32))).toEqual({ resets: 0, forwarded: 1 });
    // Oryx's own commands, as the Moonlander's other host software sends them.
    expect(await run(new Uint8Array([0xfe, 0, 0]))).toEqual({ resets: 0, forwarded: 1 });
  });

  test("a packet too short to hold the magic is passed on, never read past its end", async () => {
    expect(await run(bootloaderPacket(), 8)).toEqual({ resets: 0, forwarded: 1 });
    expect(await run(bootloaderPacket(), 9)).toEqual({ resets: 1, forwarded: 0 });
  });
});

describe("generating hands-free source", () => {
  test("without the option nothing is added, so the output is what Oryx's own source builds to", () => {
    const { get, g } = files();
    expect(get("keymap.c")).not.toContain("__wrap_raw_hid_receive");
    expect(get("rules.mk")).not.toContain("--wrap");
    expect(get("config.h")).toContain('#define SERIAL_NUMBER "QxKPz/zLQ3Md"');
    expect(g.requiredSymbols).toBeUndefined();
  });

  test("the serial number becomes the build marker, once", () => {
    const h = files({ buildId: BUILD }).get("config.h");
    expect(h.match(/#define SERIAL_NUMBER/g)).toHaveLength(1);
    expect(h).toContain('#define SERIAL_NUMBER "keyloom/NPQRSTVWXYZ0"');
    expect(h).not.toContain("QxKPz/zLQ3Md");
  });

  test("the linker is told to wrap raw_hid_receive and link-time optimisation is off", () => {
    const rules = files({ buildId: BUILD }).get("rules.mk");
    expect(rules).toContain("LDFLAGS += -Wl,--wrap=raw_hid_receive");
    expect(rules).toContain("LTO_ENABLE = no");
    // Appended after the layout's own rules, so a LTO_ENABLE = yes there cannot win.
    expect(rules.indexOf("LTO_ENABLE = no")).toBeGreaterThan(rules.indexOf("ORYX_ENABLE = yes"));
  });

  test("keymap.c carries the wrapper, and the build must define it", () => {
    const { g, get } = files({ buildId: BUILD });
    expect(get("keymap.c")).toContain(wrapperSource());
    expect(g.requiredSymbols).toEqual([WRAPPER_SYMBOL]);
  });

  test("the wrapper's magic, in C, is the same bytes the host sends", () => {
    const c = wrapperSource();
    const chars = /keyloom_bootloader_magic\[\] = \{([^}]+)\}/.exec(c)?.[1]?.split(",").map((x) => x.trim().replace(/'/g, "")).join("");
    expect(chars).toBe(BOOTLOADER_MAGIC);
    expect(c).toContain(`0x${BOOTLOADER_COMMAND.toString(16)}`);
  });

  test("is the same on every run, and only for ZSA boards", () => {
    expect(files({ buildId: BUILD }).g).toEqual(files({ buildId: BUILD }).g);
    expect(() => generateQmkSource({ layout, board: { ...board.definition, vendor: "Other" }, revisionId: "rev_T", handsFree: { buildId: BUILD } })).toThrow(GenerateError);
  });
});
