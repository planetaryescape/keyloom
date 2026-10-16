// The device version a keyboard reports (bcdDevice), which QMK sets from `device_version` and so helps tell boards that share IDs apart (22).
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { linuxUsbDevices, parseUsbDevices } from "../../../src/firmware/toolchain/usb.ts";
import { tempDir } from "../../helpers/tmp.ts";

describe("bcdDevice", () => {
  test("macOS 26 reports it as USBDeviceKeyProductVersion, in hex", () => {
    const [d] = parseUsbDevices({ SPUSBHostDataType: [{ _name: "Glove80 Left", USBDeviceKeyProductID: "0x27db", USBDeviceKeyVendorID: "0x16c0", USBDeviceKeyProductVersion: "0x0305" }] });
    expect(d).toMatchObject({ productId: "0x27db", vendorId: "0x16c0", bcdDevice: "0x0305" });
  });

  test("older macOS reports bcd_device as digits with a point, which is the same four digits", () => {
    const [d] = parseUsbDevices({ SPUSBDataType: [{ _name: "Corne", product_id: "0x0001", vendor_id: "0x4653", bcd_device: "0.01" }] });
    expect(d?.bcdDevice).toBe("0x0001");
    const [e] = parseUsbDevices({ SPUSBDataType: [{ _name: "Thing", product_id: "0x0001", vendor_id: "0x4653", bcd_device: "3.05" }] });
    expect(e?.bcdDevice).toBe("0x0305");
  });

  test("a device that reports none, or something that is not a version, has none", () => {
    expect(parseUsbDevices({ SPUSBDataType: [{ _name: "X", product_id: "0x0001", vendor_id: "0x4653" }] })[0]?.bcdDevice).toBeUndefined();
    expect(parseUsbDevices({ SPUSBDataType: [{ _name: "X", product_id: "0x0001", vendor_id: "0x4653", bcd_device: "latest" }] })[0]?.bcdDevice).toBeUndefined();
  });

  test("Linux's sysfs holds it as bcdDevice", () => {
    const root = tempDir();
    const dir = join(root, "1-2");
    mkdirSync(dir);
    for (const [f, v] of [["idVendor", "4653"], ["idProduct", "0001"], ["product", "Corne"], ["bcdDevice", "0001"]]) writeFileSync(join(dir, f as string), `${v}\n`);
    expect(linuxUsbDevices(root)[0]).toMatchObject({ vendorId: "0x4653", productId: "0x0001", name: "Corne", bcdDevice: "0x0001" });
  });
});
