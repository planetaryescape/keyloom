import { describe, expect, test } from "bun:test";
import { importZmk } from "../../../src/firmware/zmk/import.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { glove80 } from "../../helpers/zmk.ts";

const board = await glove80();

describe("tap dance import is all-or-nothing", () => {
  test.each([
    'tapping-term-ms = <150>, <200>;',
    'tapping-term-ms = <150 200>;',
    'tapping-term-ms = "150";',
    'tapping-term-ms;',
    'extra { flag; };',
  ])("keeps unsupported definition %s verbatim", async (extra) => {
    await kept(`bindings = <&kp A>, <&kp B>; ${extra}`);
  });

  test.each(['<123 &kp A>, <&kp B>', '<&kp A>, <123 &kp B>', '<&kp A>, "ignored"'])("does not discard unexpected bindings content %s", async (bindings) => {
    await kept(`bindings = ${bindings};`);
  });
});

async function kept(body: string) {
  const definition = `custom: custom { compatible = "zmk,behavior-tap-dance"; #binding-cells = <0>; ${body} };`;
  const source = `/ { behaviors { ${definition} }; keymap { compatible = "zmk,keymap"; base { bindings = <&custom ${Array.from({ length: 79 }, () => "&none").join(" ")}>; }; }; };`;
  const { layout } = await importZmk({ name: "fixture", keymap: source }, board.definition);
  expect(layout.tapDances).toEqual([]);
  expect(layout.layers[0]!.bindings[0]).toMatchObject({ kind: "native", source: "&custom" });
  expect(layout.passthrough.some((p) => p.source === definition)).toBe(true);
  const generated = generateZmkSource({ layout, board: board.definition, revisionId: "rev_TEST" });
  expect(generated.files[0]!.content).toContain(definition);
}
