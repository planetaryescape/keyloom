import { expect, test } from "bun:test";
import { runKeyboardChecks } from "../../src/app/doctor.ts";
import { runningKeyboard } from "../helpers/fake-hid.ts";
import type { HidTransport } from "../../src/firmware/toolchain/hid.ts";
import type { SerialTransport } from "../../src/firmware/toolchain/serial.ts";

test("doctor names denied hidraw access and scopes its remedy without opening the keyboard", async () => {
  const hid: HidTransport = {
    list: async () => [{ vendorId: 0x3297, productId: 0x1969, handle: "synthetic-ref", permissionDenied: true }],
    write: async () => { throw new Error("doctor must not write"); },
    openSession: async () => { throw new Error("doctor must not open"); },
  };
  const checks = await runKeyboardChecks({ usb: async () => [runningKeyboard("keyloom/AAAAAAAAAAAA")], hid: async () => hid, zmk: { serial: async () => ({ list: async () => [], touch: async () => { throw new Error("doctor must not touch"); } }) } });
  const check = checks.find((c) => c.name.includes("zsa/moonlander"));
  expect(check?.ok).toBe(false);
  expect(check?.detail).toContain("hidraw read/write permission denied");
  expect(check?.detail).toContain("VID 0x3297 and PID 0x1969");
  expect(check?.detail).toContain("udev rule");
});

test("doctor names denied ttyACM access and the distro group remedy without opening or touching", async () => {
  const serial: SerialTransport = {
    list: async () => [{ vendorId: 0x16c0, productId: 0x27db, path: "synthetic-ref", serial: "keyloom/AAAAAAAAAAAA-L:GLV80-synthetic", permissionDenied: true }],
    touch: async () => { throw new Error("doctor must not touch"); },
    open: async () => { throw new Error("doctor must not open"); },
  };
  const checks = await runKeyboardChecks({ usb: async () => [], zmk: { serial: async () => serial } });
  const check = checks.find((c) => c.name.includes("moergo/glove80"));
  expect(check?.ok).toBe(false);
  expect(check?.detail).toContain("ttyACM read/write permission denied");
  expect(check?.detail).toContain("dialout or uucp");
  expect(check?.detail).toContain("log out and back in");
});

test("lab permission remedies distinguish transports and remain platform-specific", async () => {
  const { LabCaptureError, linuxDevicePermissionRemedy } = await import("../../src/app/errors.ts");
  for (const transport of ["hid", "serial"] as const) {
    const message = new LabCaptureError("permission_denied", linuxDevicePermissionRemedy(transport, "linux")).message;
    expect(message).toContain(transport === "hid" ? "udev rule" : "dialout or uucp");
    expect(message).not.toMatch(/as root|chmod|666/);
    expect(linuxDevicePermissionRemedy(transport, "darwin")).toBeUndefined();
  }
});
