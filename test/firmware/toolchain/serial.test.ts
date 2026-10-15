// USB serial ports: the Linux sysfs reader against a fake tree, the macOS registry reader against this machine's registry (it opens
// nothing), and the stty touch against a fake `stty`. The preload (test/helpers/no-real-flash.ts) refuses a touch of anything under /dev.
import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SerialError, touchWithStty } from "../../../src/firmware/toolchain/serial.ts";
import { linuxSerial } from "../../../src/firmware/toolchain/serial-linux.ts";
import { macosSerial } from "../../../src/firmware/toolchain/serial-macos.ts";
import { fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";

/** /sys/devices/.../usb1/1-2 (the device, with ids and serial) and its interface 1-2:1.0, linked from /sys/class/tty/<node>/device. */
function usbTty(root: string, node: string, device: { vendor: string; product: string; serial?: string }, name = "1-2") {
  const dev = join(root, "devices", name);
  const iface = join(dev, `${name}:1.0`);
  mkdirSync(iface, { recursive: true });
  writeFileSync(join(dev, "idVendor"), `${device.vendor}\n`);
  writeFileSync(join(dev, "idProduct"), `${device.product}\n`);
  if (device.serial) writeFileSync(join(dev, "serial"), `${device.serial}\n`);
  mkdirSync(join(root, "class", "tty", node), { recursive: true });
  symlinkSync(iface, join(root, "class", "tty", node, "device"));
}

describe("USB serial ports on Linux", () => {
  test("lists the ACM ports with the owning device's ids and serial, preferring the stable by-id link", async () => {
    const root = tempDir();
    usbTty(root, "ttyACM0", { vendor: "16c0", product: "27db", serial: "keyloom/4NY1MKBCK6TY-L:GLV80-737753DA283F2ECA" }, "1-2");
    usbTty(root, "ttyACM1", { vendor: "1d50", product: "615e" }, "1-3");
    mkdirSync(join(root, "class", "tty", "tty0"));
    mkdirSync(join(root, "class", "tty", "ttyUSB0"));
    const dev = join(root, "dev");
    const byId = join(dev, "serial", "by-id");
    mkdirSync(byId, { recursive: true });
    writeFileSync(join(dev, "ttyACM0"), "");
    writeFileSync(join(dev, "ttyACM1"), "");
    symlinkSync(join(dev, "ttyACM0"), join(byId, "usb-MoErgo_Glove80_Left-if00"));
    symlinkSync(join(dev, "gone"), join(byId, "usb-dangling"));
    const found = await linuxSerial(join(root, "class", "tty"), dev, byId).list();
    expect(found).toEqual([
      { vendorId: 0x16c0, productId: 0x27db, serial: "keyloom/4NY1MKBCK6TY-L:GLV80-737753DA283F2ECA", path: join(byId, "usb-MoErgo_Glove80_Left-if00") },
      { vendorId: 0x1d50, productId: 0x615e, path: join(dev, "ttyACM1") },
    ]);
  });

  test("a port with no USB device above it, and a missing sysfs, are no ports rather than errors", async () => {
    const root = tempDir();
    mkdirSync(join(root, "class", "tty", "ttyACM0", "device"), { recursive: true });
    expect(await linuxSerial(join(root, "class", "tty"), join(root, "dev"), join(root, "none")).list()).toEqual([]);
    expect(await linuxSerial(join(root, "missing"), join(root, "dev")).list()).toEqual([]);
  });
});

describe.skipIf(process.platform !== "darwin")("USB serial ports on macOS", () => {
  test("lists what is attached with numeric ids and a device node, whatever that is, and opens nothing", async () => {
    const found = await macosSerial().list();
    expect(Array.isArray(found)).toBe(true);
    for (const p of found) {
      expect(p.vendorId).toBeGreaterThan(0);
      expect(p.productId).toBeGreaterThan(0);
      expect(p.path).toMatch(/^\/dev\/cu\./);
    }
  });

  test("a touch of a real device node is refused by the test preload", async () => {
    await expect(macosSerial().touch("/dev/cu.usbmodem1", 1200)).rejects.toThrow("tests must flash into a temporary directory");
  });
});

describe("the stty touch", () => {
  const fakeStty = (body: string) => fakeBinDir({ stty: body });
  const calls = () => join(tempDir(), "stty.calls");

  test("macOS names the device with -f and Linux with -F, and passes the baud rate as the last word", async () => {
    const log = calls();
    const bin = fakeStty('echo "$@" >> "$STTY_CALLS"');
    await withPath(bin, async () => {
      await touchWithStty("/tmp/fake-port", 1200, "darwin");
      await touchWithStty("/tmp/fake-port", 1201, "linux");
    }, { STTY_CALLS: log });
    expect((await Bun.file(log).text()).trim().split("\n")).toEqual(["-f /tmp/fake-port 1200", "-F /tmp/fake-port 1201"]);
  });

  test("a permission error says how to get access on Linux, and other failures keep stty's own words", async () => {
    await withPath(fakeStty('echo "stty: /tmp/p: Permission denied" >&2; exit 1'), async () => {
      await expect(touchWithStty("/tmp/p", 1200, "linux")).rejects.toThrow("dialout");
      await expect(touchWithStty("/tmp/p", 1200, "darwin")).rejects.toThrow(/no permission to open \/tmp\/p$/);
    });
    await withPath(fakeStty('echo "stty: /tmp/p: No such file or directory" >&2; exit 1'), async () => {
      const err = (await touchWithStty("/tmp/p", 1200, "linux").catch((e) => e)) as SerialError;
      expect(err).toBeInstanceOf(SerialError);
      expect(err.message).toContain("No such file or directory");
    });
  });

  test("a real device node is refused before stty runs", async () => {
    const log = calls();
    await withPath(fakeStty('echo "$@" >> "$STTY_CALLS"'), async () => {
      await expect(touchWithStty("/dev/cu.usbmodem1", 1200, "darwin")).rejects.toThrow("tests must flash into a temporary directory");
      await expect(touchWithStty("/dev/ttyACM0", 1200, "linux")).rejects.toThrow("tests must flash");
    }, { STTY_CALLS: log });
    expect(await Bun.file(log).exists()).toBe(false);
  });
});
