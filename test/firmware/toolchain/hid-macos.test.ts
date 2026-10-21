// Default tests never inventory a real keyboard. The preload supplies an empty metadata bus and refuses effects.
import { describe, expect, test } from "bun:test";
import { bootloaderPacket } from "../../../src/firmware/qmk/handsfree.ts";
import { macosHid } from "../../../src/firmware/toolchain/hid-macos.ts";

describe.skipIf(process.platform !== "darwin")("raw HID on macOS", () => {
  test("default metadata enumeration is synthetic and empty", async () => {
    expect(await macosHid().list()).toEqual([]);
  });

  test("tests can't write: the preload refuses it", async () => {
    await expect(macosHid().write({ vendorId: 0x3297, productId: 0x1969, handle: "1" }, bootloaderPacket())).rejects.toThrow("tests must inject a fake transport");
  });
});
