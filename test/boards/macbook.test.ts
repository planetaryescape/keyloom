import { describe, expect, test } from "bun:test";
import { checkBoardDir } from "../../src/boards/check.ts";
import { keySlots } from "../../src/boards/key-slots.ts";
import { getBoard } from "../../src/boards/registry.ts";
import { physicalKeys } from "../../src/firmware/kanata/board-config.ts";
import { kanataName } from "../../src/layout/keycodes.ts";

const dir = `${import.meta.dir}/../../boards/apple/macbook-ansi`;
const board = getBoard("apple/macbook-ansi");

describe("apple/macbook-ansi", () => {
  test("boards check passes, with a warning that the geometry is hand-written and unverified", async () => {
    const result = await checkBoardDir(dir);
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.message)).toEqual([expect.stringContaining("hand-authored and not yet checked against the device (S36)")]);
  });

  test("77 keys with a hand, a finger and a row each, and no mirror", () => {
    const d = board.definition;
    expect(d.firmware).toBe("kanata");
    expect(d.keyCount).toBe(77);
    expect(board.geometry.keys).toHaveLength(77);
    expect(d.hands.left.length + d.hands.right.length).toBe(77);
    expect(Object.keys(d.fingers)).toHaveLength(77);
    expect(Object.values(d.rows).flat().sort((a, b) => a - b)).toEqual([...Array(77).keys()]);
    expect(d.mirror).toEqual({});
  });

  test("every row of the geometry is 14.5 key units wide, as Apple's are; the function row stops a unit short where Touch ID sits", () => {
    const byRow = new Map<number, number>();
    for (const k of board.geometry.keys) byRow.set(k.y, Math.max(byRow.get(k.y) ?? 0, k.x + k.w));
    expect(byRow.get(0)).toBeCloseTo(13.5, 6);
    // The stacked Up and Down keys share the last row's right edge with Right, so only their top half is the row's own edge.
    for (const [y, right] of byRow) if (y > 0 && y !== 5.25) expect(right, `row at y=${y}`).toBeCloseTo(14.5, 6);
  });

  test("every key the board uses has a kanata name on macOS, and fn is the one that isn't a KeyCode", () => {
    const keys = physicalKeys(board.definition);
    expect(keys).toHaveLength(77);
    const names = keys.map((k) => (k.kind === "fn" ? "fn" : kanataName(k.code)));
    expect(names.filter((n) => n === undefined)).toEqual([]);
    expect(new Set(names).size).toBe(77);
    expect(keys.filter((k) => k.kind === "fn")).toHaveLength(1);
  });

  test("the typing block places like a touch typist's hands: A and the home row are home, Space is a thumb", () => {
    const d = board.definition;
    const slots = keySlots(d, board.geometry).slots;
    const at = (code: string) => physicalKeys(d).findIndex((k) => k.kind === "key" && k.code === code);
    expect(slots.get(at("A"))).toMatchObject({ hand: "left", finger: "pinky", rowOffset: 0 });
    expect(slots.get(at("J"))).toMatchObject({ hand: "right", finger: "index", rowOffset: 0 });
    expect(slots.get(at("SPACE"))).toMatchObject({ thumb: true });
    expect(d.rows.home).toContain(at("F"));
  });

  test("declares no lighting, with a reason the agent can quote", () => {
    expect(board.definition.lighting).toBeUndefined();
    expect(board.definition.limits?.lighting).toContain("backlight");
  });
});
