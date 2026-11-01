import { expect, test } from "bun:test";
import { requireCommandSupport, PlatformUnavailableError } from "../../src/firmware/toolchain/platform-support.ts";
import { classify, EXIT } from "../../src/cli/errors.ts";

for (const command of ["build", "flash", "sync run", "sync status", "autosync on", "lab start", "lab analyse", "remap doctor", "keyboard detect", "keyboard put", "emulate", "workload evaluate", "workload compare", "serve", "config use", "boards geometry", "boards check"]) {
  test(`Windows refuses ${command} with a typed command-specific roadmap error`, () => {
    expect(() => requireCommandSupport(command, {}, "win32")).toThrow(PlatformUnavailableError);
    try { requireCommandSupport(command, {}, "win32"); } catch (error) {
      const result = classify(error, "unused");
      expect(result.code).toBe(EXIT.toolchain);
      expect(result.kind).toBe("platform_unavailable");
      expect(result.message).toContain(`keyloom ${command} is not available on Windows yet`);
      expect(result.message).toContain("#rung-24f");
    }
    expect(() => requireCommandSupport(command, {}, "darwin")).not.toThrow();
    expect(() => requireCommandSupport(command, {}, "linux")).not.toThrow();
  });
}

test("Windows keeps layout editing, boards, change and helper diagnostics available", () => {
  for (const command of ["import", "layout list", "layout show", "boards list", "boards show", "change apply", "change check", "doctor", "config new", "version restore", "generate", "workload list"]) {
    expect(() => requireCommandSupport(command, {}, "win32")).not.toThrow();
  }
  expect(() => requireCommandSupport("boards check", { offline: true }, "win32")).not.toThrow();
});

test("the CLI guard precedes layout lookup and normal Windows doctor skips device/toolchain probes", async () => {
  const { runCli } = await import("../../src/cli/main.ts");
  const { tempDir } = await import("../helpers/tmp.ts");
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  let out = "";
  let err = "";
  const io = { out: (text: string) => { out += text; }, err: (text: string) => { err += text; }, isTTY: false };
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    const dir = tempDir();
    expect(await runCli(["--data-dir", dir, "build", "missing-layout"], io)).toBe(EXIT.toolchain);
    expect(out + err).toContain("keyloom build is not available on Windows yet");
    expect(out + err).not.toContain("not found");
    out = ""; err = "";
    expect(await runCli(["--data-dir", dir, "doctor", "--format", "json"], io)).toBe(0);
    const report = JSON.parse(out);
    expect(report.ok).toBe(true);
    expect(report.checks.filter((check: { detail: string }) => check.detail.includes("not available on Windows yet"))).toHaveLength(3);
    expect(err).toBe("");
  } finally { Object.defineProperty(process, "platform", original); }
});

test("app entry points refuse or report on Windows when called directly, without probing", async () => {
  const { detectKeyboards } = await import("../../src/app/keyboard-detect.ts");
  const { rebootKeyboard } = await import("../../src/app/keyboard.ts");
  const { runToolchainChecks, runKeyboardChecks, runRemapperChecks } = await import("../../src/app/doctor.ts");
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    let probed = false;
    await expect(detectKeyboards({ usb: async () => { probed = true; return []; } })).rejects.toThrow(PlatformUnavailableError);
    await expect(rebootKeyboard()).rejects.toThrow("keyloom flash --reboot-only is not available on Windows yet");
    for (const checks of [await runToolchainChecks(), await runKeyboardChecks(), await runRemapperChecks()]) {
      expect(checks).toHaveLength(1);
      expect(checks[0]!.detail).toContain("not available on Windows yet");
    }
    expect(probed).toBe(false);
  } finally {
    Object.defineProperty(process, "platform", original);
  }
});

test("only a compiled combined Windows candidate admits recording and explicit reboot", () => {
  for (const command of ["lab start", "lab sessions", "lab show", "lab delete", "lab passages"]) {
    expect(() => requireCommandSupport(command, {}, "win32", "native")).not.toThrow();
  }
  expect(() => requireCommandSupport("flash", { rebootOnly: true }, "win32", "native")).not.toThrow();
  for (const backend of ["legacy", "native-hid", "native-serial"] as const) {
    expect(() => requireCommandSupport("lab start", {}, "win32", backend)).toThrow(PlatformUnavailableError);
    expect(() => requireCommandSupport("flash", { rebootOnly: true }, "win32", backend)).toThrow(PlatformUnavailableError);
  }
  for (const command of ["flash", "build", "sync run", "autosync on", "remap start", "serve", "emulate", "workload evaluate", "workload compare", "keyboard put", "config use"]) {
    expect(() => requireCommandSupport(command, {}, "win32", "native")).toThrow(PlatformUnavailableError);
  }
});

test("Windows workload preflight precedes suite/ops reads, layout lookup and replay, but list remains available", async () => {
  const { runCli } = await import("../../src/cli/main.ts");
  const { tempDir } = await import("../helpers/tmp.ts");
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  let calls = 0;
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    const dir = tempDir();
    for (const command of ["evaluate", "compare"]) {
      let out = ""; let err = "";
      const io = { out: (s: string) => { out += s; }, err: (s: string) => { err += s; }, isTTY: false };
      const args = ["--data-dir", dir, "workload", command, "missing-layout", "--suite", "/must-not-read-suite"];
      if (command === "compare") args.push("--ops", "/must-not-read-ops");
      const code = await runCli(args, io, {}, undefined, undefined, undefined, undefined, { replay: async () => { calls++; throw new Error("must not replay"); } });
      expect(code).toBe(EXIT.toolchain);
      expect(JSON.parse(err).error.code).toBe("platform_unavailable");
      expect(err).toContain(`keyloom workload ${command} is not available on Windows yet`);
      expect(out).toBe("");
    }
    let out = "";
    expect(await runCli(["--data-dir", dir, "workload", "list"], { out: (s) => { out += s; }, err: () => {}, isTTY: false })).toBe(0);
    expect(JSON.parse(out).suites).toHaveLength(6);
    expect(calls).toBe(0);
  } finally { Object.defineProperty(process, "platform", original); }
});

test("Windows doctor distinguishes missing drivers and a busy port without device I/O", async () => {
  const { runWindowsDeviceChecks } = await import("../../src/app/doctor.ts");
  const { DeviceTransportError } = await import("../../src/firmware/toolchain/device-helper/transport-client.ts");
  let opened = false;
  const forbidden = async () => { opened = true; throw new Error("no device I/O permitted"); };
  const checks = await runWindowsDeviceChecks({
    hid: async () => ({ list: async () => [{ vendorId: 0x3297, productId: 0x1969, handle: "synthetic-missing", driverMissing: true }], write: forbidden, openSession: forbidden }),
    zmk: { serial: async () => ({ list: async () => [{ vendorId: 0x16c0, productId: 0x27db, path: "synthetic-missing", driverMissing: true }], touch: forbidden, open: forbidden }) },
  });
  expect(checks).toHaveLength(2);
  expect(checks.every((c) => !c.ok && c.detail.startsWith("unsupported:"))).toBe(true);
  expect(checks[0]!.detail).toContain("in-box HID");
  expect(checks[1]!.detail).toContain("usbser.sys");
  const busy = await runWindowsDeviceChecks({ hid: async () => ({ list: async () => [], write: forbidden }), zmk: { serial: async () => ({ list: async () => { throw new DeviceTransportError({ code: "busy", effect: "none", retry: "after_user_action" }); }, touch: forbidden }) } });
  expect(busy[0]!.detail).toStartWith("busy:");
  expect(busy[0]!.detail).toContain("Close the serial monitor");
  expect(opened).toBe(false);
  expect(JSON.stringify([...checks, ...busy])).not.toMatch(/Zadig|admin rights|elevat/i);
});
