// "Compare with now" says a key in words (D-316): what it does, and what changed, not "TD0 → TD0".
import { describe, expect, test } from "bun:test";
import type { Binding, Layout, TapDance } from "../../src/layout/schema.ts";
import { changeWords, keyWords } from "../../src/web/history/compare-words.ts";

const ctx = (tapDances: TapDance[] = []): Pick<Layout, "layers" | "macros" | "tapDances" | "passthrough"> => ({
  layers: [{ id: "nav", name: "Navigation", bindings: [] }], macros: [], tapDances, passthrough: [],
});
const dance = (over: Partial<TapDance> = {}): TapDance => ({ id: "dance-0", name: "Tap dance 0", tap: { kind: "key", code: "SPACE" }, doubleTap: { kind: "key", code: "LEFT_BRACKET" }, ...over });
const td: Binding = { kind: "tapDance", tapDanceId: "dance-0" };

describe("a tap dance", () => {
  test("is named by what it does, and a slot it gained is said", () => {
    const then = ctx([dance()]);
    const now = ctx([dance({ hold: { kind: "modifier", mods: ["LCTL", "LSFT", "LALT", "LGUI"] } })]);
    const words = keyWords(td, then, td, now);
    expect(words.now).toMatch(/^Space, twice for \[/);
    expect(words.change).toMatch(/^now also holds for /);
  });

  test("a slot it lost, and a slot that changed, are said too", () => {
    expect(changeWords(td, ctx([dance()]), td, ctx([dance({ doubleTap: undefined })]))).toMatch(/^no longer twice for \[/);
    expect(changeWords(td, ctx([dance()]), td, ctx([dance({ doubleTap: { kind: "key", code: "RIGHT_BRACKET" } })]))).toMatch(/^now twice for \] \(was \[\)$/);
  });

  test("an Oryx dance kept as firmware code then, read into an editable dance now", () => {
    const native: Binding = { kind: "native", firmware: "qmk", source: "TD(DANCE_0)", label: "TD0" };
    expect(changeWords(native, ctx(), td, ctx([dance()]))).toBe("keyloom reads it now; it was firmware code it couldn't edit");
  });
});

describe("a hold-tap key", () => {
  test("a hold added or taken away is said", () => {
    const a: Binding = { kind: "key", code: "A" };
    const aCtrl: Binding = { kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LCTL"] }, profileId: "hrm" };
    expect(changeWords(a, ctx(), aCtrl, ctx())).toMatch(/^now also holds for /);
    expect(changeWords(aCtrl, ctx(), a, ctx())).toMatch(/^no longer holds for /);
    expect(changeWords(aCtrl, ctx(), { ...aCtrl, hold: { layerId: "nav" } } as Binding, ctx())).toBe("now holds for Navigation");
    // The row leads with the tap alone, so the hold isn't said twice.
    expect(keyWords(a, ctx(), aCtrl, ctx()).title).toBe("A");
  });
});
