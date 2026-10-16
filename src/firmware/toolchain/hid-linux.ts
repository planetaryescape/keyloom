// Raw HID on Linux through /dev/hidrawN, found by reading sysfs. Needs no native code. Opening the
// node for writing needs a udev rule that gives the user access, which is also what QMK and ZSA's own
// tools need; the error says so.
import { readFileSync, readdirSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { type HidTransport, HidError, RAW_HID_REPORT_SIZE, RAW_HID_USAGE, RAW_HID_USAGE_PAGE, type RawHidInterface } from "./hid.ts";
import { openPolled } from "./polled-file.ts";

// Report descriptor items: `06 60 FF` is Usage Page (0xFF60), `09 61` is Usage (0x61).
const RAW_HID_DESCRIPTOR = Buffer.from([0x06, RAW_HID_USAGE_PAGE & 0xff, RAW_HID_USAGE_PAGE >> 8, 0x09, RAW_HID_USAGE]);

const tryRead = (path: string): Buffer | undefined => {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
};

/** `sysClass` and `devDir` are parameters so tests can use a fake tree. */
export function linuxHid(sysClass = "/sys/class/hidraw", devDir = "/dev"): HidTransport {
  return {
    async list() {
      let nodes: string[];
      try {
        nodes = readdirSync(sysClass).filter((n) => /^hidraw\d+$/.test(n));
      } catch {
        return [];
      }
      const found: RawHidInterface[] = [];
      for (const node of nodes) {
        const device = join(sysClass, node, "device");
        const descriptor = tryRead(join(device, "report_descriptor"));
        if (!descriptor?.includes(RAW_HID_DESCRIPTOR)) continue;
        // uevent has `HID_ID=0003:00003297:00001969` (bus, vendor, product) and `HID_UNIQ=<serial>`.
        const uevent = tryRead(join(device, "uevent"))?.toString("utf8") ?? "";
        const id = /^HID_ID=[0-9A-Fa-f]+:([0-9A-Fa-f]+):([0-9A-Fa-f]+)$/m.exec(uevent);
        if (!id) continue;
        const serial = /^HID_UNIQ=(.+)$/m.exec(uevent)?.[1]?.trim();
        found.push({ vendorId: Number.parseInt(id[1] as string, 16), productId: Number.parseInt(id[2] as string, 16), ...(serial ? { serial } : {}), handle: join(devDir, node) });
      }
      return found;
    },

    async openSession(target, onReport, onError) {
      try {
        // One read of a hidraw node is one report, so a report is never split or joined.
        const file = openPolled(target.handle, (chunk) => onReport(chunk), { chunkSize: RAW_HID_REPORT_SIZE, ...(onError ? { onError } : {}) });
        return { write: (report) => file.write(report), close: () => file.close() };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") {
          throw new HidError(`no permission to open ${target.handle}. Install ZSA's udev rules (https://github.com/zsa/wally/wiki/Linux-install) or run keyloom with access to it, then try again`);
        }
        throw new HidError(`could not open ${target.handle}: ${(err as Error).message}`);
      }
    },

    async write(target, report) {
      let file;
      try {
        file = await open(target.handle, "w");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") {
          throw new HidError(`no permission to write to ${target.handle}. Install ZSA's udev rules (https://github.com/zsa/wally/wiki/Linux-install) or run keyloom with access to it, then try again`);
        }
        throw new HidError(`could not open ${target.handle}: ${(err as Error).message}`);
      }
      try {
        // No report ID in the descriptor, so the report is written as is.
        await file.write(report);
      } finally {
        await file.close();
      }
    },
  };
}
