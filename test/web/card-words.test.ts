import { describe, expect, test } from "bun:test";
import { applyWords, cardTitle, modWords } from "../../src/web/card/card-words.ts";
import { seatCard } from "../../src/web/card/card-seat.ts";
import type { Binding } from "../../src/layout/schema.ts";

const layout = {
  layers: [{ id: "base", name: "Base", bindings: [] }, { id: "nav", name: "navigate", bindings: [] }],
  macros: [{ id: "m", name: "ST_MACRO_0", steps: [] }],
  tapDances: [{ id: "d", name: "x", tap: { kind: "key" as const, code: "SPACE", mods: ["LALT" as const] }, doubleTap: { kind: "key" as const, code: "LEFT_BRACKET" } }],
  passthrough: [],
};
const ht = (hold: Binding extends never ? never : { mods: ("LCTL" | "RALT")[] } | { layerId: string }): Binding => ({ kind: "holdTap", tap: { code: "I" }, hold, profileId: "p" });

describe("the key card's words", () => {
  test("titles say what the key is", () => {
    expect(cardTitle({ kind: "key", code: "I" }, layout)).toBe("I");
    expect(cardTitle(ht({ mods: ["RALT"] }), layout)).toBe("I, or hold for Option");
    expect(cardTitle({ kind: "layer", action: "to", layerId: "nav" }, layout)).toBe("Go to Navigate");
    expect(cardTitle({ kind: "layer", action: "oneShot", layerId: "nav" }, layout)).toBe("Navigate for one key");
    expect(cardTitle({ kind: "macro", macroId: "m" }, layout)).toBe("A macro");
    expect(cardTitle({ kind: "tapDance", tapDanceId: "d" }, layout)).toBe("Option + Space, twice for [");
    expect(cardTitle({ kind: "native", firmware: "qmk", source: "OSM(MOD_LSFT)", label: "OS⇧" }, layout)).toBe("⇧ for one key");
    expect(cardTitle({ kind: "native", firmware: "qmk", source: "RGB_HUD", label: "Hue-" }, layout)).toBe("Hue− (lights)");
  });

  test("Apply says the change in words", () => {
    expect(applyWords({ kind: "key", code: "I" }, ht({ mods: ["LCTL"] }), layout)).toBe("Hold I for Control");
    expect(applyWords({ kind: "key", code: "I" }, { kind: "key", code: "F17" }, layout)).toBe("Make it F17");
    expect(applyWords({ kind: "key", code: "I" }, { kind: "transparent" }, layout)).toBe("Let it fall through");
    expect(modWords(["LCTL", "LSFT", "LALT", "LGUI"])).toBe("Hyper");
    expect(modWords(["LSFT", "LGUI"])).toBe("Shift + Command");
  });
});

describe("where the card sits (BK: the halves part only when needed)", () => {
  const area = { x: 0, y: 100, w: 1366, h: 500 };
  const card = { w: 352, h: 380 };
  const row = (x0: number, n: number) => Array.from({ length: n }, (_, i) => ({ x: x0 + i * 50, y: 200, w: 46, h: 46 }));
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  test("a card that fits beside the board doesn't move it", () => {
    const left = row(500, 3);
    const right = row(700, 3);
    const seat = seatCard({ area, key: left[0]!, keyHand: "left", left, right, card });
    expect(seat.part).toBeNull();
    expect(seat.shift).toBe(0);
    expect([...left, ...right].some((b) => overlaps(b, { x: seat.x, y: seat.y, w: card.w, h: card.h }))).toBe(false);
  });

  const narrowArea = { x: 0, y: 100, w: 1000, h: 500 };

  test("a wide board parts: the half without the key slides by what the card needs, and the card sits in the gap", () => {
    const left = row(60, 7);
    const right = row(460, 7);
    const key = left[6]!;
    const seat = seatCard({ area: narrowArea, key, keyHand: "left", left, right, card });
    expect(seat.part?.hand).toBe("right");
    const moved = (b: (typeof right)[number], dx: number) => ({ ...b, x: b.x + dx });
    const placed = { x: seat.x, y: seat.y, w: card.w, h: card.h };
    expect(left.some((b) => overlaps(moved(b, seat.shift), placed))).toBe(false);
    expect(right.some((b) => overlaps(moved(b, seat.shift + (seat.part?.px ?? 0)), placed))).toBe(false);
  });

  test("a key on the right half parts the left half the other way", () => {
    const seat = seatCard({ area: narrowArea, key: row(460, 7)[0]!, keyHand: "right", left: row(60, 7), right: row(460, 7), card });
    expect(seat.part?.hand).toBe("left");
    expect(seat.part?.px).toBeLessThan(0);
  });
});

describe("a macro named only by its firmware slot", () => {
  test("is called by what it sends", async () => {
    const { macroWords } = await import("../../src/web/card/card-words.ts");
    expect(macroWords({ name: "ST_MACRO_1", steps: [{ op: "tap", code: "LEFT_GUI" }, { op: "waitMs", ms: 100 }, { op: "tap", code: "C" }] })).toBe("Command, then C");
    expect(macroWords({ name: "Copy, switch, paste", steps: [] })).toBe("Copy, switch, paste");
  });
});
