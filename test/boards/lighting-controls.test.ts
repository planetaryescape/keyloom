// The board fact that its firmware has lighting control keys (D-453). It is optional: every board.json without it parses, a wrong
// type is refused, and only the Glove80 sets it, from its firmware's own underglow config.
import { describe, expect, test } from "bun:test";
import { BoardDefinitionSchema } from "../../src/boards/schema.ts";
import { hasLightingControls } from "../../src/boards/capabilities.ts";
import { loadBoardDir } from "../../src/boards/load.ts";
import { GLOVE80_DIR } from "../helpers/zmk.ts";
import { MOONLANDER_DIR } from "../helpers/board.ts";
import { tiny, tinyBoard } from "../helpers/tiny.ts";
import { readFileSync } from "node:fs";

const rawGlove80 = () => JSON.parse(readFileSync(`${GLOVE80_DIR}/board.json`, "utf8")) as Record<string, unknown>;

describe("board.json lightingControls", () => {
  test("the schema accepts the fact as true or false, and a board without it (every board written before D-453)", () => {
    const { lightingControls: _, ...without } = rawGlove80();
    expect(BoardDefinitionSchema.safeParse(without).success).toBe(true);
    expect(BoardDefinitionSchema.safeParse({ ...without, lightingControls: true }).success).toBe(true);
    expect(BoardDefinitionSchema.safeParse({ ...without, lightingControls: false }).success).toBe(true);
  });

  test("a wrong type is refused, and the error names the field", () => {
    for (const value of ["yes", 1, null, { on: true }]) {
      const result = BoardDefinitionSchema.safeParse({ ...rawGlove80(), lightingControls: value });
      expect(result.success).toBe(false);
      expect(result.success ? [] : result.error.issues.map((i) => i.path.join("."))).toContain("lightingControls");
    }
  });

  test("the Glove80 sets it; the Moonlander, Corne and MacBook don't, since each has its own evidence or none (D-453)", async () => {
    expect((await loadBoardDir(GLOVE80_DIR)).definition.lightingControls).toBe(true);
    expect((await loadBoardDir(MOONLANDER_DIR)).definition.lightingControls).toBeUndefined();
    expect((await loadBoardDir(`${import.meta.dir}/../../boards/foostan/corne`)).definition.lightingControls).toBeUndefined();
    expect((await loadBoardDir(`${import.meta.dir}/../../boards/apple/macbook-ansi`)).definition.lightingControls).toBeUndefined();
  });
});

describe("hasLightingControls: one answer for a lighting key on any board (D-453)", () => {
  test("admitted by per-key LEDs, by the board's fact, or by a lighting control in the layout", () => {
    const blank = tiny();
    const rgb = { kind: "native" as const, firmware: "zmk" as const, source: "&rgb_ug RGB_TOG", label: "TOG" };
    const withRgb = tiny({ layers: tiny().layers.map((l) => ({ ...l, bindings: [rgb, ...l.bindings.slice(1)] })) });
    const noLight = { ...tinyBoard, firmware: "zmk" as const };
    delete noLight.lighting;
    expect(hasLightingControls(noLight, blank)).toBe(false);
    expect(hasLightingControls({ ...noLight, lightingControls: true }, blank)).toBe(true);
    expect(hasLightingControls(noLight, withRgb)).toBe(true);
    expect(hasLightingControls({ ...noLight, lightingControls: false }, blank)).toBe(false);
  });
});
