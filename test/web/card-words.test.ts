import { describe, expect, test } from "bun:test";
import { applyWords, cardTitle, modWords } from "../../src/web/card/card-words.ts";
import { placeCard } from "../../src/web/card/card-place.ts";
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

describe("where the card goes", () => {
  const stage = { x: 0, y: 0, w: 1440, h: 800 };
  const card = { w: 340, h: 400 };

  test("beside the key, on the side with more room, never over the key or its neighbours", () => {
    const key = { x: 1000, y: 300, w: 50, h: 50 };
    const keep = [key, { x: 950, y: 300, w: 50, h: 50 }, { x: 1050, y: 300, w: 50, h: 50 }];
    const at = placeCard({ stage, key, keep, card });
    expect(at.shift).toBe(0);
    expect(at.x + card.w).toBeLessThanOrEqual(950);
  });

  test("when neither side has room the board slides and the card still clears the keys", () => {
    const narrow = { x: 0, y: 0, w: 700, h: 800 };
    const key = { x: 330, y: 300, w: 50, h: 50 };
    const at = placeCard({ stage: narrow, key, keep: [key], card });
    expect(at.shift).not.toBe(0);
    const moved = { ...key, x: key.x + at.shift };
    expect(moved.x + moved.w <= at.x || moved.x >= at.x + card.w).toBe(true);
  });
});

describe("a macro named only by its firmware slot", () => {
  test("is called by what it sends", async () => {
    const { macroWords } = await import("../../src/web/card/card-words.ts");
    expect(macroWords({ name: "ST_MACRO_1", steps: [{ op: "tap", code: "LEFT_GUI" }, { op: "waitMs", ms: 100 }, { op: "tap", code: "C" }] })).toBe("Command, then C");
    expect(macroWords({ name: "Copy, switch, paste", steps: [] })).toBe("Copy, switch, paste");
  });
});
