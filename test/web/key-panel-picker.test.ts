import { describe, expect, test } from "bun:test";
import { openingTab, pickerSections, tabsFor, type PickerQuery } from "../../src/web/panel/picker-items.ts";
import { loadFixture } from "../server/fixture.ts";

const { document: layout } = await loadFixture();
const base = (patch: Partial<PickerQuery>): PickerQuery => ({
  text: "", tab: "letters", slot: "tap", keysOnly: false, layout, firmware: "qmk", layerId: "base", layerAction: "momentary", ...patch,
});
const ids = (query: Partial<PickerQuery>) => pickerSections(base(query)).flatMap((section) => section.items.map((item) => item.id));

describe("the picker offers each slot what it can take", () => {
  test("a hold opens on Modifiers and offers only modifiers and layers", () => {
    expect(openingTab("hold", null)).toBe("modifiers");
    expect(tabsFor("hold", false)).toEqual(["modifiers", "layers"]);
    const held = ids({ slot: "hold", tab: "modifiers" });
    expect(held).toHaveLength(8);
    expect(held).toContain("key-LEFT_CTRL");
  });

  test("a hold can't point at the layer being edited", () => {
    const layers = pickerSections(base({ slot: "hold", tab: "layers" })).flatMap((s) => s.items);
    expect(layers.find((item) => item.pick.t === "layer" && item.pick.layerId === "base")?.disabled).toBe(true);
    expect(layers.some((item) => item.disabled !== true)).toBe(true);
  });

  test("the tap of a hold-tap offers keys only, with no layers, macros or Any", () => {
    expect(tabsFor("tap", true)).not.toContain("layers");
    expect(tabsFor("tap", true)).not.toContain("any");
    expect(tabsFor("tap", false)).toContain("any");
    expect(ids({ tab: "other", keysOnly: true })).not.toContain("special-none");
  });

  test("layer picks carry the action chosen in the picker", () => {
    const items = pickerSections(base({ tab: "layers", layerAction: "toggle" })).flatMap((s) => s.items);
    expect(items.every((item) => item.pick.t === "layer" && item.pick.action === "toggle")).toBe(true);
  });

  test("a tab lists only its own keys, and the letters tab starts with A", () => {
    const letters = ids({ tab: "letters" });
    expect(letters[0]).toBe("key-A");
    expect(letters).toContain("key-N1");
    expect(letters).not.toContain("key-ENTER");
    expect(ids({ tab: "navigation" })).toContain("key-ENTER");
  });
});

describe("a search looks across tabs and finds plain names", () => {
  test("typing a key's name finds it first, whatever tab is showing", () => {
    expect(ids({ text: "volume", tab: "letters" })[0]).toMatch(/^key-/);
    expect(ids({ text: "backspace", tab: "media" })).toContain("key-BACKSPACE");
  });

  test("it finds layers and special keys by name, after the keys", () => {
    const hits = ids({ text: layout.layers[1]?.name.toLowerCase() ?? "nav" });
    expect(hits.some((id) => id.startsWith("layer-"))).toBe(true);
    expect(ids({ text: "transparent" })).toContain("special-transparent");
    expect(ids({ text: "nothing" })).toContain("special-none");
  });

  test("a hold's search finds modifiers and layers, not letters", () => {
    expect(ids({ text: "ctrl", slot: "hold" }).every((id) => id.startsWith("key-") || id.startsWith("layer-"))).toBe(true);
    expect(ids({ text: "a", slot: "hold" })).not.toContain("key-A");
  });

  test("nothing matching is an empty list, not an error", () => {
    expect(pickerSections(base({ text: "zzzzzz" }))).toEqual([]);
  });
});
