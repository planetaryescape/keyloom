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

test("CLI emits a structured restart-required error and does not write an unexpected-bug log", async () => {
  const { app, layoutId } = await commandShiftApp();
  try {
    let out = "";
    let err = "";
    const io: Io = { out: (text) => { out += text; }, err: (text) => { err += text; }, isTTY: false };
    const lab: LabCliDeps = {
      terminal: { isInteractive: true, typing: async () => "" },
      lab: {
        startCapture: async () => { throw new DeviceTransportError({ code: "helper_exited", effect: "possible", retry: "never" }); },
        replay: () => async () => { throw new Error("capture start must not replay"); },
      },
    };
    const code = await runCli(["--data-dir", app.dataDir, "--format", "json", "lab", "start", layoutId, "--text", "hello"], io, {}, undefined, undefined, lab);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("keyloom is recording this keyboard's key presses");
    const jsonError = err.trim().split("\n").at(-1);
    if (!jsonError) throw new Error("CLI did not print its structured error");
    expect(JSON.parse(jsonError)).toEqual({
      schema_version: 1,
      error: {
        code: "restart_required",
        message: "The keyboard connection has stopped responding. Restart keyloom (or its serve process), then try again.",
      },
    });
    expect(err).not.toContain("unexpected error");
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
