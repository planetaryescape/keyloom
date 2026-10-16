// The library lists macros, tap dances and timing profiles with where each is used (16, D-085).
import { describe, expect, test } from "bun:test";
import type { Layout, TapDance } from "../../src/layout/schema.ts";
import { libraryOf, positionsOn } from "../../src/web/panel/library.ts";
import { key, tiny } from "../helpers/tiny.ts";

const dance: TapDance = { id: "d1", name: "Esc, Caps", tap: { kind: "key", code: "ESCAPE" }, doubleTap: { kind: "macro", macroId: "m1" } };
const layout = (): Layout => {
  const base = tiny({ tapDances: [dance] });
  return {
    ...base,
    layers: base.layers.map((l, i) =>
      i === 0 ? { ...l, bindings: [{ kind: "tapDance", tapDanceId: "d1" }, { kind: "macro", macroId: "m1" }, key("C"), { kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LSFT"] }, profileId: "p" }] }
      : i === 1 ? { ...l, bindings: [{ kind: "tapDance", tapDanceId: "d1" }, ...l.bindings.slice(1)] } : l,
    ),
  };
};

describe("the library", () => {
  const lib = libraryOf(layout());

  test("a macro is used by the keys that run it and the tap dance slots that hold it", () => {
    expect(lib.macros).toHaveLength(1);
    expect(lib.macros[0]?.uses.map((u) => u.label)).toEqual(["the Esc key on Base", "the Macro key on Base", "the Esc key on Numbers"]);
    expect(lib.macros[0]?.detail).toBe("One step");
  });

  test("a tap dance is used by each key that has it, and says which slots it has", () => {
    expect(lib.tapDances[0]?.detail).toBe("tap, double-tap");
    expect(lib.tapDances[0]?.uses.map((u) => u.slot)).toEqual([{ layerId: "base", position: 0 }, { layerId: "num", position: 0 }]);
  });

  test("a profile is used by the hold-taps that name it; one nothing uses says so by having no uses", () => {
    expect(lib.profiles[0]?.uses.map((u) => u.label)).toEqual(["the A hold ⇧ key on Base"]);
    expect(libraryOf(tiny()).macros[0]?.uses).toEqual([]);
  });

  test("a combo whose output is the item counts, with no key to point at", () => {
    const l = { ...tiny(), combos: [{ id: "c", name: "Paste combo", positions: [0, 1], layerIds: "all" as const, output: { kind: "macro" as const, macroId: "m1" } }] };
    expect(libraryOf(l).macros[0]?.uses).toEqual([{ label: "The combo A + B" }]);
  });

  test("the board highlights only the uses on the layer it shows", () => {
    const uses = lib.tapDances[0]?.uses ?? [];
    expect(positionsOn(uses, "base")).toEqual([0]);
    expect(positionsOn(uses, "num")).toEqual([0]);
    expect(positionsOn(uses, "nav")).toEqual([]);
  });
});
