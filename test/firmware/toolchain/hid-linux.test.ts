import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootloaderPacket } from "../../../src/firmware/qmk/handsfree.ts";
import { HidError } from "../../../src/firmware/toolchain/hid.ts";
import { linuxHid } from "../../../src/firmware/toolchain/hid-linux.ts";
import { linuxUsbDevices } from "../../../src/firmware/toolchain/usb.ts";
import { tempDir } from "../../helpers/tmp.ts";

// A descriptor with the usage page and usage QMK's raw HID declares (06 60 FF, 09 61), inside other items.
const RAW_DESCRIPTOR = Buffer.from([0x05, 0x01, 0x09, 0x06, 0xa1, 0x01, 0xc0, 0x06, 0x60, 0xff, 0x09, 0x61, 0xa1, 0x01, 0xc0]);
const KEYBOARD_DESCRIPTOR = Buffer.from([0x05, 0x01, 0x09, 0x06, 0xa1, 0x01, 0xc0]);

function node(root: string, name: string, descriptor: Buffer, uevent: string) {
  const dir = join(root, name, "device");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report_descriptor"), descriptor);
  writeFileSync(join(dir, "uevent"), uevent);
}

describe("raw HID on Linux", () => {
  test("lists only the raw HID interface, with its ids and serial, and the /dev node to write to", async () => {
    const sys = tempDir();
    node(sys, "hidraw0", KEYBOARD_DESCRIPTOR, "HID_ID=0003:00003297:00001969\nHID_UNIQ=QxKPz/zLQ3Md\n");
    node(sys, "hidraw1", RAW_DESCRIPTOR, "HID_ID=0003:00003297:00001969\nHID_NAME=ZSA Moonlander Mark I\nHID_UNIQ=keyloom/NPQRSTVWXYZ0\n");
    node(sys, "hidraw2", RAW_DESCRIPTOR, "HID_ID=0003:0000046D:0000C52B\n");
    mkdirSync(join(sys, "not-a-hidraw"));
    const found = await linuxHid(sys, "/dev").list();
    expect(found).toHaveLength(2);
    expect(found).toEqual(expect.arrayContaining([
      { vendorId: 0x3297, productId: 0x1969, serial: "keyloom/NPQRSTVWXYZ0", handle: "/dev/hidraw1" },
      { vendorId: 0x046d, productId: 0xc52b, handle: "/dev/hidraw2" },
    ]));
  });

  test("an empty or missing sysfs is no devices, not an error", async () => {
    expect(await linuxHid(join(tempDir(), "missing"), "/dev").list()).toEqual([]);
  });

  test("writes the report as it is to the device node", async () => {
    const dev = tempDir();
    const path = join(dev, "hidraw1");
    writeFileSync(path, "");
    await linuxHid(tempDir(), dev).write({ vendorId: 0x3297, productId: 0x1969, handle: path }, bootloaderPacket());
    expect([...readFileSync(path)]).toEqual([...bootloaderPacket()]);
  });

  test("a node that can't be opened is a HidError that names the cause", async () => {
    await expect(linuxHid(tempDir(), "/dev").write({ vendorId: 1, productId: 1, handle: join(tempDir(), "missing", "hidraw9") }, new Uint8Array(32))).rejects.toThrow(HidError);
  });
});

describe("USB devices on Linux", () => {
  test("reads ids, names and serial from sysfs, skipping interfaces", () => {
    const sys = tempDir();
    const dev = join(sys, "1-2");
    mkdirSync(dev, { recursive: true });
    writeFileSync(join(dev, "idVendor"), "3297\n");
    writeFileSync(join(dev, "idProduct"), "1969\n");
    writeFileSync(join(dev, "serial"), "keyloom/NPQRSTVWXYZ0\n");
    writeFileSync(join(dev, "product"), "Moonlander Mark I\n");
    mkdirSync(join(sys, "1-2:1.0"));
    expect(linuxUsbDevices(sys)).toEqual([{ productId: "0x1969", vendorId: "0x3297", name: "Moonlander Mark I", maker: "", serial: "keyloom/NPQRSTVWXYZ0" }]);
    expect(linuxUsbDevices(join(sys, "nope"))).toEqual([]);
  });
});
