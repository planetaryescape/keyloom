import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LabCaptureError } from "../../src/app/index.ts";
import { runCli } from "../../src/cli/main.ts";
import type { LabCliDeps } from "../../src/cli/commands/lab.ts";
import type { Io } from "../../src/cli/output.ts";
import { DeviceTransportError } from "../../src/firmware/toolchain/device-helper/transport-client.ts";
import { classify } from "../../src/cli/errors.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { tempDir } from "../helpers/tmp.ts";

test("CLI keeps the JSON error parseable and announces before capture", async () => {
  const { app, layoutId } = await commandShiftApp();
  try {
    for (const format of ["json", "jsonl"] as const) {
      let out = "";
      let err = "";
      const events: string[] = [];
      const io: Io = { out: (text) => { out += text; events.push("stdout"); }, err: (text) => { err += text; events.push("stderr"); }, isTTY: false };
      const lab: LabCliDeps = {
        terminal: { isInteractive: true, typing: async () => "" },
        lab: {
          startCapture: async () => {
            expect(out).toContain("keyloom is recording this keyboard's key presses");
            events.push("capture");
            throw new DeviceTransportError({ code: "helper_exited", effect: "possible", retry: "never" });
          },
          replay: () => async () => { throw new Error("capture start must not replay"); },
        },
      };
      const code = await runCli(["--data-dir", app.dataDir, "--format", format, "lab", "start", layoutId, "--text", "hello"], io, {}, undefined, undefined, lab);
      expect(code).toBe(2);
      expect(out).toContain("keyloom is recording this keyboard's key presses");
      expect(JSON.parse(err.trim())).toEqual({
        schema_version: 1,
        error: {
          code: "restart_required",
          message: "The keyboard connection has stopped responding. Restart keyloom (or its serve process), then try again.",
        },
      });
      expect(events.indexOf("stdout")).toBeLessThan(events.indexOf("capture"));
      expect(events.indexOf("capture")).toBeLessThan(events.indexOf("stderr"));
      expect(err).not.toContain("unexpected error");
      expect(existsSync(join(app.dataDir, "logs"))).toBe(false);
    }

    let tableErr = "";
    const tableIo: Io = { out: () => {}, err: (text) => { tableErr += text; }, isTTY: false };
    await runCli(["--data-dir", app.dataDir, "--format", "table", "lab", "start", layoutId, "--text", "hello"], tableIo, {}, undefined, undefined, {
      terminal: { isInteractive: true, typing: async () => "" },
      lab: {
        startCapture: async () => { throw new DeviceTransportError({ code: "helper_exited", effect: "possible", retry: "never" }); },
        replay: () => async () => { throw new Error("capture start must not replay"); },
      },
    });
    expect(tableErr).toContain("keyloom is recording this keyboard's key presses");
    expect(tableErr).toContain("The keyboard connection has stopped responding.");
    expect(existsSync(join(app.dataDir, "logs"))).toBe(false);
  } finally { app.db.close(); }
});

for (const code of ["busy", "permission_denied", "restart_required"] as const) {
  test(`CLI treats ${code} as an actionable refusal, not an unexpected bug`, () => {
    const data = tempDir();
    const error = new LabCaptureError(code);
    expect(classify(error, data)).toEqual({ code: 2, kind: code, message: error.message });
    expect(existsSync(join(data, "logs"))).toBe(false);
  });
}
