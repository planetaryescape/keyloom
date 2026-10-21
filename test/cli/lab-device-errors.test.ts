import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LabCaptureError } from "../../src/app/index.ts";
import { classify } from "../../src/cli/errors.ts";
import { tempDir } from "../helpers/tmp.ts";

for (const code of ["busy", "permission_denied"] as const) {
  test(`CLI treats ${code} as an actionable refusal, not an unexpected bug`, () => {
    const data = tempDir();
    const error = new LabCaptureError(code);
    expect(classify(error, data)).toEqual({ code: 2, kind: code, message: error.message });
    expect(existsSync(join(data, "logs"))).toBe(false);
  });
}
