import { expect, test } from "bun:test";
import { evaluate } from "../../src/validation/validate.ts";
import { generateQmkSource } from "../../src/firmware/qmk/generate.ts";
import type { FirmwareSetting } from "../../src/layout/schema.ts";
import { tiny, tinyBoard } from "../helpers/tiny.ts";

for (const value of ["200\nstatic inline void injected(void) {}", "200\r#define EXTRA 1", "(some_function())", "200\\", "200\0"]) {
  test(`setting edits reject new source ${JSON.stringify(value)}`, () => {
    const result = evaluate(tinyBoard, tiny(), [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "TAPPING_TERM", value } }]).result;
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "native_edit")).toBe(true);
  });
}

for (const key of ["TAPPING_TERM\n#define EXTRA", "X()", "X /*", "X\\", "X\0"]) {
  test(`setting edits reject source in a setting name ${JSON.stringify(key)}`, () => {
    expect(evaluate(tinyBoard, tiny(), [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key, value: 200 } }]).result.ok).toBe(false);
  });
}

test("an imported expression stays unchanged, can be removed, and can become a typed value", () => {
  const layout = tiny({ settings: [{ firmware: "qmk", key: "TAPPING_TERM", value: "(TAPPING_TERM + 10)" }] });
  expect(evaluate(tinyBoard, layout, []).result.ok).toBe(true);
  expect(evaluate(tinyBoard, layout, [{ op: "setFirmwareSetting", setting: layout.settings[0]! }]).result.ok).toBe(true);
  expect(evaluate(tinyBoard, layout, [{ op: "removeFirmwareSetting", firmware: "qmk", key: "TAPPING_TERM" }]).result.ok).toBe(true);
  expect(evaluate(tinyBoard, layout, [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "TAPPING_TERM", value: 170 } }]).result.ok).toBe(true);
});

test("numeric and boolean settings remain editable, including options outside the settings page", () => {
  const settings: FirmwareSetting[] = [
    { firmware: "qmk", key: "TAPPING_TERM", value: 170 },
    { firmware: "qmk", key: "PERMISSIVE_HOLD", value: true },
    { firmware: "qmk", key: "RGB_MATRIX_STARTUP_SPD", value: 60 },
  ];
  expect(evaluate(tinyBoard, tiny(), settings.map((setting) => ({ op: "setFirmwareSetting", setting }))).result.ok).toBe(true);
});

for (const setting of [
  { key: "TAPPING_TERM", value: "200\n#define EXTRA 1" },
  { key: "TAPPING_TERM", value: "200\\" },
  { key: "X\n#define EXTRA", value: true },
]) {
  test(`direct QMK generation rejects a definition breakout ${JSON.stringify(setting)}`, () => {
    const layout = tiny({ settings: [{ firmware: "qmk", ...setting }] });
    expect(() => generateQmkSource({ board: tinyBoard, layout, revisionId: "rev_SECURITY", boardRevisionId: "reva" })).toThrow("one config.h definition");
  });
}
