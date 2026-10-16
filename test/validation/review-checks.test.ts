import { describe, expect, test } from "bun:test";
import type { Layout } from "../../src/layout/schema.ts";
import { reviewChecks } from "../../src/validation/review-checks.ts";
import { ReviewItemSchema, cleanMarkers, itemId } from "../../src/validation/review-item.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const NONE = { kind: "none" } as const;
const checks = (doc: Layout) => reviewChecks(tinyBoard, doc);

describe("the checks", () => {
  test("a layout with nothing wrong gives no items and says what it looked at", () => {
    const r = checks(tiny());
    expect(r.items).toEqual([]);
    expect(r.summary).toEqual({ layers: 3, keys: 4, combos: 1 });
  });

  test("a layer nothing switches to is a problem that marks the layer, with the words and ids the screen draws from", () => {
    const doc = tiny({ layers: [...tiny().layers, { id: "magic", name: "Magic", bindings: [key("A"), key("B"), key("C"), key("D")] }] });
    const [item] = checks(doc).items;
    expect(ReviewItemSchema.parse(item)).toMatchObject({
      id: "check:layer_unreachable:magic:", source: "check", kind: "problem", severity: "warning", code: "layer_unreachable",
      title: "{layer:magic} can't be reached", layers: ["magic"], keys: [], proposalId: null, fixes: [], dismissedAt: null,
    });
    expect(item?.body).toContain("{layer:base}");
  });

  test("keys that do nothing on the base layer are one hint, naming the keys; a key that does something is left out", () => {
    const base = tiny().layers[0];
    const doc = tiny({ layers: [{ ...(base as NonNullable<typeof base>), bindings: [key("A"), NONE, T, key("D")] }, ...tiny().layers.slice(1)] });
    const hints = checks(doc).items.filter((i) => i.code === "keys_do_nothing");
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ kind: "hint", severity: "info", keys: [{ layerId: "base", position: 1 }, { layerId: "base", position: 2 }] });
    expect(hints[0]?.title).toBe("2 keys do nothing on {layer:base}");
  });

  test("a transparent key on a layer above the base is not a key that does nothing", () => {
    expect(checks(tiny()).items.filter((i) => i.code === "keys_do_nothing")).toEqual([]);
  });

  test("a warning the validator gives for a layout as it stands becomes a hint or a problem, never dropped", () => {
    const doc = tiny({
      tapDances: [{ id: "td", name: "Dance", tap: { kind: "key", code: "X" }, doubleTap: { kind: "key", code: "X" } }],
      layers: [{ id: "base", name: "Base", bindings: [{ kind: "tapDance", tapDanceId: "td" }, key("B"), { kind: "layer", action: "momentary", layerId: "num" }, key("D")] }, ...tiny().layers.slice(1)],
    });
    const item = checks(doc).items.find((i) => i.code === "tap_dance_same_action");
    expect(item).toMatchObject({ kind: "hint", severity: "info", source: "check" });
    expect(item?.keys).toEqual([{ layerId: "base", position: 0 }]);
  });

  test("a layer you could get stuck on is a problem about that layer", () => {
    const doc = tiny({
      layers: [
        { id: "base", name: "Base", bindings: [key("A"), key("B"), { kind: "layer", action: "to", layerId: "num" }, key("D")] },
        { id: "num", name: "Numbers", bindings: [key("N1"), key("N2"), key("N3"), key("N4")] },
      ],
      combos: [],
    });
    const trap = checks(doc).items.find((i) => i.code === "layer_trap");
    expect(trap).toMatchObject({ kind: "problem", layers: ["num"] });
    expect(trap?.keys).toEqual([{ layerId: "base", position: 2 }]);
  });
});

describe("item ids", () => {
  test("they come from the code, the layers and the keys, in any order", () => {
    const a = itemId({ source: "agent", code: "layer-key-target", layers: ["b", "a"], keys: [{ layerId: "x", position: 3 }, { layerId: "x", position: 1 }] });
    const b = itemId({ source: "agent", code: "layer-key-target", layers: ["a", "b"], keys: [{ layerId: "x", position: 1 }, { layerId: "x", position: 3 }] });
    expect(a).toBe(b);
    expect(a).toBe("agent:layer-key-target:a,b:x/1,x/3");
  });

  test("a different set of keys is a different finding, and the same code from the checks and the agent are two", () => {
    const k = (n: number) => [{ layerId: "x", position: n }];
    expect(itemId({ source: "check", code: "c", layers: [], keys: k(1) })).not.toBe(itemId({ source: "check", code: "c", layers: [], keys: k(2) }));
    expect(itemId({ source: "check", code: "c", layers: [], keys: k(1) })).not.toBe(itemId({ source: "agent", code: "c", layers: [], keys: k(1) }));
  });

  test("a long list of keys makes a short id that still tells lists apart", () => {
    const many = (extra: number) => Array.from({ length: 40 }, (_, i) => ({ layerId: "layer-0", position: i === 39 ? extra : i }));
    const a = itemId({ source: "check", code: "keys_do_nothing", layers: [], keys: many(90) });
    expect(a.length).toBeLessThan(60);
    expect(a).not.toBe(itemId({ source: "check", code: "keys_do_nothing", layers: [], keys: many(91) }));
  });
});

describe("markers", () => {
  const layers = new Map([["base", { name: "Base", keyCount: 4 }]]);
  test("markers for a layer and key the layout has are kept; the rest are written as words, so no chip points at nothing", () => {
    expect(cleanMarkers("{key:base:2} on {layer:base}", layers)).toBe("{key:base:2} on {layer:base}");
    expect(cleanMarkers("{key:nowhere:2} and {layer:ghost}", layers)).toBe("nowhere and ghost");
    expect(cleanMarkers("{key:base:9}", layers)).toBe("key 10 on Base");
  });
});
