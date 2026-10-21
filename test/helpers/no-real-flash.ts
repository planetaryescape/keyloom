// Preloaded before every test file (bunfig.toml). A test that forgets its fake zapp must hit this
// refusal, never the real one, and a test that forgets its volumes directory must never resolve the
// real mount root: a real flash rewrites the keyboard BK types on.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mock } from "bun:test";
import * as hid from "../../src/firmware/toolchain/hid.ts";
import * as hidDefault from "../../src/firmware/toolchain/hid-default.ts";
import * as hidMacos from "../../src/firmware/toolchain/hid-macos.ts";
import * as serialMacos from "../../src/firmware/toolchain/serial-macos.ts";
import * as usb from "../../src/firmware/toolchain/usb.ts";
import { isSyntheticExecutable } from "./fake-bin.ts";
import * as polled from "../../src/firmware/toolchain/polled-file.ts";
import * as serial from "../../src/firmware/toolchain/serial.ts";
import * as serialDefault from "../../src/firmware/toolchain/serial-default.ts";
import * as volumes from "../../src/firmware/zmk/volumes.ts";
import * as helperSpawn from "../../src/firmware/toolchain/device-helper/spawn.ts";

// Even diagnostics must inject their intended synthetic child; no new helper backend can escape the preload.
mock.module("../../src/firmware/toolchain/device-helper/spawn.ts", () => ({
  ...helperSpawn,
  launchHelper: () => { throw new Error("real device helper is blocked in tests; inject a synthetic launcher"); },
}));

const dir = mkdtempSync(join(tmpdir(), "keyloom-no-flash-"));
mkdirSync(dir, { recursive: true });
// The DFU tools write to whatever bootloader is on the bus (22, D-365), so they get the same refusal as zapp.
for (const name of ["zapp", "dfu-programmer", "dfu-util", "avrdude"]) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\necho "the real ${name} is blocked in tests; pass a fake" >&2\nexit 97\n`);
  chmodSync(path, 0o755);
}
process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;

// Where a Glove80's boot drive appears on a real machine. Tests give the flash a temporary directory instead.
const REAL_ROOTS = ["/Volumes", "/run/media", "/media", "/mnt"];
const refuse = (what: string): never => {
  throw new Error(`${what}: tests must flash into a temporary directory (pass volumesRoot); the real mount root would write to a real keyboard`);
};

// Bun updates the real module's exports in place when it is mocked, so the real function is kept here first.
const realVolumeFinderAt = volumes.volumeFinderAt;
mock.module("../../src/firmware/zmk/volumes.ts", () => ({
  ...volumes,
  defaultVolumesRoot: () => refuse("defaultVolumesRoot()"),
  defaultVolumeFinder: () => refuse("defaultVolumeFinder()"),
  lsblkFinder: () => refuse("lsblkFinder()"),
  volumeFinderAt: (root: string) => {
    const r = resolve(root);
    if (REAL_ROOTS.some((p) => r === p || r.startsWith(`${p}/`))) refuse(`volumeFinderAt(${root})`);
    return realVolumeFinderAt(root);
  },
}));

// A keyboard running keyloom's firmware reboots into its bootloader on one raw-HID packet, so no test may reach the real
// HID transports. Metadata enumeration also stays synthetic; tests must never inventory a real bus. Tests inject fakes (HandsFreeDeps).
const refuseHid = (what: string): never => {
  throw new Error(`${what}: tests must inject a fake transport (HandsFreeDeps); a real write would reboot a real keyboard`);
};
const readOnly = (): hid.HidTransport => ({
  list: async () => [],
  write: async () => refuseHid("HidTransport.write()"),
  // The typing lab's reader (D-281) would start a key stream on a real keyboard.
  openSession: async () => refuseHid("HidTransport.openSession()"),
});
mock.module("../../src/firmware/toolchain/hid-default.ts", () => ({
  ...hidDefault,
  defaultHidTransport: async () => refuseHid("defaultHidTransport()"),
}));
mock.module("../../src/firmware/toolchain/hid-macos.ts", () => ({ ...hidMacos, macosHid: () => readOnly() }));
const realMacosSerial = serialMacos.macosSerial;
mock.module("../../src/firmware/toolchain/serial-macos.ts", () => ({
  ...serialMacos, macosSerial: () => ({ ...realMacosSerial(), list: async () => [] }),
}));
const syntheticUsbList = usb.listUsbDevices;
mock.module("../../src/firmware/toolchain/usb.ts", () => ({
  ...usb, listUsbDevices: async () => {
    const profiler = Bun.which("system_profiler", { PATH: process.env.PATH ?? "" });
    return profiler && isSyntheticExecutable(profiler) ? syntheticUsbList() : [];
  },
}));

// A half running keyloom's firmware reboots into its bootloader when its serial port is closed at 1200 baud, so no test may touch a
// real port. Touching a path under /dev is refused; a test's fake stty on a temporary path still runs. Listing is replaced by an empty
// bus, so a keyboard on the desk can't change a test's outcome; tests inject fakes (ZmkHandsFreeDeps) to see any port.
const realTouch = serial.touchWithStty;
const realOpenWithStty = serial.openWithStty;
mock.module("../../src/firmware/toolchain/serial.ts", () => ({
  ...serial,
  touchWithStty: async (path: string, baud: number, platform?: NodeJS.Platform) => {
    if (path.startsWith("/dev/")) refuse(`touchWithStty(${path})`);
    return realTouch(path, baud, platform);
  },
  openWithStty: async (path: string, ...rest: [never, never, never]) => {
    if (path.startsWith("/dev/")) refuse(`openWithStty(${path})`);
    return realOpenWithStty(path, ...rest);
  },
}));
mock.module("../../src/firmware/toolchain/serial-default.ts", () => ({
  ...serialDefault,
  defaultSerialTransport: async () => ({
    list: async () => [],
    touch: async (path: string) => refuse(`SerialTransport.touch(${path})`),
    open: async (path: string) => refuse(`SerialTransport.open(${path})`),
  }),
}));
// The typing lab's stream starts on a command written to a real port or hidraw node; a test may open only a path it made itself.
const realOpenPolled = polled.openPolled;
mock.module("../../src/firmware/toolchain/polled-file.ts", () => ({
  ...polled,
  openPolled: (path: string, ...rest: [never, never]) => {
    if (path.startsWith("/dev/")) refuse(`openPolled(${path})`);
    return realOpenPolled(path, ...rest);
  },
}));

