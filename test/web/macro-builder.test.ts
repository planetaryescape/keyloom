// The Macro tab's builder (16#macros-are-made-in-the-picker-and-each-pick-adds-a-step, D-088).
import { describe, expect, test } from "bun:test";
import { looksLikeSecret } from "../../src/layout/secret.ts";
import type { Macro } from "../../src/layout/schema.ts";
import {
  addKey, addText, builderFromMacro, emptyBuilder, generatedName, moveStep, parseChordQuery, removeStep, rename, setStepMods, setWait, summary, toMacro,
} from "../../src/web/panel/macro-builder.ts";
import { tiny } from "../helpers/tiny.ts";

const copySwitchPaste = () => {
  let b = emptyBuilder();
  b = addKey(b, "C", ["LGUI"]);
  b = addKey(b, "TAB", ["LGUI"]);
  b = setWait(b, 1, 100);
  b = addKey(b, "V", ["LGUI"]);
  return b;
};

describe("building a macro one pick at a time", () => {
  test("three picks are three steps, and the wait is its own step after the key it follows", () => {
    const m = toMacro(copySwitchPaste(), tiny());
    expect(m).toEqual({
      id: "macro-2",
      name: "Copy, switch, paste",
      steps: [
        { op: "tap", code: "C", mods: ["LGUI"] },
        { op: "tap", code: "TAB", mods: ["LGUI"] },
        { op: "waitMs", ms: 100 },
        { op: "tap", code: "V", mods: ["LGUI"] },
      ],
    });
  });

  test("the summary reads it back in words, waits included", () => {
    expect(summary(copySwitchPaste().steps)).toBe("Sends ⌘C, then ⌘Tab, waits 100 ms, then ⌘V");
    expect(summary([])).toBe("Nothing yet. Add keys or type some text.");
    expect(summary(addText(emptyBuilder(), "git status").steps)).toBe('Types "git status"');
    expect(summary(addText(addKey(emptyBuilder(), "A", []), "hi").steps)).toBe('Sends A, then types "hi"');
  });

  test("typed text is one step, empty text adds nothing", () => {
    const b = addText(addKey(emptyBuilder(), "A", []), "hello");
    expect(toMacro(b, tiny())?.steps).toEqual([{ op: "tap", code: "A" }, { op: "text", text: "hello" }]);
    expect(addText(emptyBuilder(), "")).toEqual(emptyBuilder());
  });

  test("steps move, change modifiers and delete; a move off either end does nothing", () => {
    let b = copySwitchPaste();
    b = moveStep(b, 2, -1);
    expect(b.steps.map((s) => (s.kind === "key" ? s.code : ""))).toEqual(["C", "V", "TAB"]);
    expect(moveStep(b, 0, -1)).toEqual(b);
    expect(moveStep(b, 2, 1)).toEqual(b);
    b = setStepMods(b, 0, ["LGUI", "LSFT"]);
    expect(b.steps[0]).toMatchObject({ mods: ["LSFT", "LGUI"] });
    b = removeStep(b, 1);
    expect(b.steps).toHaveLength(2);
    expect(toMacro(removeStep(removeStep(b, 0), 0), tiny())).toBeNull();
  });

  test("a wait is a whole number of milliseconds, never negative", () => {
    const b = addKey(emptyBuilder(), "A", []);
    expect(setWait(b, 0, -5).steps[0]?.waitMs).toBe(0);
    expect(setWait(b, 0, 12.6).steps[0]?.waitMs).toBe(13);
    expect(setWait(b, 0, Number.NaN).steps[0]?.waitMs).toBe(0);
    expect(toMacro(setWait(b, 0, 0), tiny())?.steps).toEqual([{ op: "tap", code: "A" }]);
  });
});

describe("names", () => {
  test("the generated name follows the steps until the person names it", () => {
    expect(generatedName(copySwitchPaste().steps)).toBe("Copy, switch, paste");
    expect(generatedName(addKey(emptyBuilder(), "Q", ["LGUI"]).steps)).toBe("⌘Q");
    expect(generatedName(addText(emptyBuilder(), "git status").steps)).toBe('Type "git status"');
    expect(generatedName([])).toBe("New macro");
    const named = rename(copySwitchPaste(), "Move text");
    expect(toMacro(named, tiny())?.name).toBe("Move text");
    expect(toMacro(rename(named, "  "), tiny())?.name).toBe("Copy, switch, paste");
  });

  test("two macros never share a name or an id", () => {
    const l = tiny({ macros: [{ id: "macro-2", name: "Copy, switch, paste", steps: [{ op: "tap", code: "A" }] }] });
    const m = toMacro(copySwitchPaste(), l);
    expect(m?.name).toBe("Copy, switch, paste 2");
    expect(m?.id).not.toBe("macro-2");
    const again = toMacro(copySwitchPaste(), l, [m as Macro]);
    expect(again?.name).toBe("Copy, switch, paste 3");
    expect(again?.id).not.toBe(m?.id);
  });
});

describe("editing a macro that already exists", () => {
  test("its steps come back as the builder's, with the waits, and go out the same", () => {
    const macro: Macro = {
      id: "m9", name: "Mine", steps: [{ op: "tap", code: "C", mods: ["LGUI"] }, { op: "waitMs", ms: 50 }, { op: "waitMs", ms: 50 }, { op: "text", text: "x" }],
    };
    const b = builderFromMacro(macro);
    expect(b).toMatchObject({ id: "m9", nameTouched: true });
    expect(b?.steps[0]).toMatchObject({ waitMs: 100 });
    expect(toMacro(b as NonNullable<typeof b>, tiny())).toEqual({ id: "m9", name: "Mine", steps: [{ op: "tap", code: "C", mods: ["LGUI"] }, { op: "waitMs", ms: 100 }, { op: "text", text: "x" }] });
  });

  test("a macro whose name is the generated one keeps following its steps", () => {
    const macro = toMacro(copySwitchPaste(), tiny()) as Macro;
    expect(builderFromMacro(macro)?.nameTouched).toBe(false);
  });

  test("press and release steps, or a wait with nothing before it, can't be shown", () => {
    expect(builderFromMacro({ id: "a", name: "A", steps: [{ op: "press", code: "LEFT_SHIFT" }, { op: "release", code: "LEFT_SHIFT" }] })).toBeNull();
    expect(builderFromMacro({ id: "a", name: "A", steps: [{ op: "waitMs", ms: 10 }, { op: "tap", code: "A" }] })).toBeNull();
    expect(builderFromMacro({ id: "a", name: "A", steps: [{ op: "tap", mods: ["LGUI"] }] })).toBeNull();
  });
});

describe("a chord typed in the search", () => {
  test("leading modifier words or symbols become modifiers and the rest is the key", () => {
    expect(parseChordQuery("cmd c")).toEqual({ mods: ["LGUI"], rest: "c", waitMs: 0 });
    expect(parseChordQuery("⌘+tab")).toEqual({ mods: ["LGUI"], rest: "tab", waitMs: 0 });
    expect(parseChordQuery("⌘c")).toEqual({ mods: ["LGUI"], rest: "c", waitMs: 0 });
    expect(parseChordQuery("ctrl shift z")).toEqual({ mods: ["LCTL", "LSFT"], rest: "z", waitMs: 0 });
    expect(parseChordQuery("opt+left")).toEqual({ mods: ["LALT"], rest: "left", waitMs: 0 });
    expect(parseChordQuery("cmd")).toEqual({ mods: ["LGUI"], rest: "", waitMs: 0 });
  });

  test("a wait typed after the key is the pause that follows it", () => {
    expect(parseChordQuery("cmd tab, wait 100")).toEqual({ mods: ["LGUI"], rest: "tab", waitMs: 100 });
    expect(parseChordQuery("tab wait 250ms")).toEqual({ mods: [], rest: "tab", waitMs: 250 });
    expect(parseChordQuery("wait 100")).toEqual({ mods: [], rest: "", waitMs: 100 });
    expect(parseChordQuery("waiting").waitMs).toBe(0);
    expect(parseChordQuery("wait").rest).toBe("wait");
  });

  test("a word that only starts like a modifier is a search, not a chord", () => {
    expect(parseChordQuery("command line")).toEqual({ mods: ["LGUI"], rest: "line", waitMs: 0 });
    expect(parseChordQuery("shiftlock")).toEqual({ mods: [], rest: "shiftlock", waitMs: 0 });
    expect(parseChordQuery("altitude")).toEqual({ mods: [], rest: "altitude", waitMs: 0 });
    expect(parseChordQuery("")).toEqual({ mods: [], rest: "", waitMs: 0 });
  });
});

describe("text that looks like a password", () => {
  test("is flagged by the same test the validator uses", () => {
    expect(looksLikeSecret("Tr0ub4dor&3")).toBe(true);
    expect(looksLikeSecret("git status")).toBe(false);
    expect(looksLikeSecret("short1A!")).toBe(true);
    expect(looksLikeSecret("short1A")).toBe(false);
  });
});
