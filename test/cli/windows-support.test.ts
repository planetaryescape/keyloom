import { expect, test } from "bun:test";
import { requireCommandSupport, PlatformUnavailableError } from "../../src/firmware/toolchain/platform-support.ts";
import { classify, EXIT } from "../../src/cli/errors.ts";

for (const command of ["build", "flash", "sync run", "sync status", "autosync on", "lab start", "lab analyse", "remap doctor", "keyboard detect", "keyboard put", "emulate", "serve", "config use", "boards geometry", "boards check"]) {
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
  for (const command of ["import", "layout list", "layout show", "boards list", "boards show", "change apply", "change check", "doctor", "config new", "version restore", "generate"]) {
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
    expect(report.checks.filter((check: { detail: string }) => check.detail.includes("not available on Windows yet"))).toHaveLength(5);
    expect(err).toBe("");
  } finally { Object.defineProperty(process, "platform", original); }
});
