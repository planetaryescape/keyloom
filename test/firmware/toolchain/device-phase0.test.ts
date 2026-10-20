// S58 characterization, not desired native behavior: independent kernel framing comparison; only synthetic files.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { linuxHid } from "../../../src/firmware/toolchain/hid-linux.ts";
import { tempDir } from "../../helpers/tmp.ts";

test("S58: old Linux writes omit the hidraw report-number byte required by the kernel contract", async () => {
  const dir = tempDir();
  const path = join(dir, "synthetic-node");
  writeFileSync(path, "");
  const payload = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  await linuxHid(dir, dir).write({ vendorId: 1, productId: 2, handle: path }, payload);
  const observed = readFileSync(path);
  const kernelBuffer = Buffer.from([0, ...payload]);
  expect(observed).toEqual(Buffer.from(payload));
  expect(observed).not.toEqual(kernelBuffer);
});

test("S58: old descriptor discovery admits a usage substring without checking report shape", async () => {
  const dir = tempDir();
  const device = join(dir, "hidraw0", "device");
  mkdirSync(device, { recursive: true });
  // This is deliberately not a valid report descriptor, let alone a 32-byte report.
  writeFileSync(join(device, "report_descriptor"), Uint8Array.from([6, 0x60, 0xff, 9, 0x61]));
  writeFileSync(join(device, "uevent"), "HID_ID=0003:00000001:00000002\n");
  expect(await linuxHid(dir, dir).list()).toEqual([{ vendorId: 1, productId: 2, handle: join(dir, "hidraw0") }]);
});
