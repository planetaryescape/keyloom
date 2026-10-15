// The macOS transport against this machine's I/O Registry. Listing reads the registry and opens nothing, so it is safe with a
// keyboard attached; the preload (test/helpers/no-real-flash.ts) turns every write into a refusal.
import { describe, expect, test } from "bun:test";
import { bootloaderPacket } from "../../../src/firmware/qmk/handsfree.ts";
import { macosHid } from "../../../src/firmware/toolchain/hid-macos.ts";

describe.skipIf(process.platform !== "darwin")("raw HID on macOS", () => {
  test("lists raw-HID interfaces with numeric ids, whatever is attached", async () => {
    const found = await macosHid().list();
    expect(Array.isArray(found)).toBe(true);
    for (const h of found) {
      expect(h.vendorId).toBeGreaterThan(0);
      expect(h.productId).toBeGreaterThan(0);
      expect(h.handle).toMatch(/^\d+$/);
    }
  });

  test("tests can't write: the preload refuses it", async () => {
    await expect(macosHid().write({ vendorId: 0x3297, productId: 0x1969, handle: "1" }, bootloaderPacket())).rejects.toThrow("tests must inject a fake transport");
  });
});
