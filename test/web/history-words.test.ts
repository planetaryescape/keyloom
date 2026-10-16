import { describe, expect, test } from "bun:test";
import { historyWords } from "../../src/web/history/history-words.ts";

const layout = {
  layers: [
    { id: "layer-0", name: "Layer 0", bindings: Array.from({ length: 30 }, (_, i) => (i === 24 ? { kind: "key" as const, code: "X" } : { kind: "key" as const, code: "A" })) },
    { id: "layer-3", name: "Numbers", bindings: [] },
  ],
  macros: [],
  tapDances: [],
} as never;

describe("History rows in people's words (D-312)", () => {
  test("an old numbered summary gets the key's cap and its layer, and no double colon", () => {
    expect(historyWords("Undo: Layer 0, key 25: X", layout)).toEqual({ how: "Undone", cap: "X", layer: "Layer 0", text: "X" });
  });

  test("firmware modifier names read as the caps print them", () => {
    expect(historyWords("Layer 0, key 1: Tap /, hold Right Ctrl + Right Alt", layout).text).toBe("/, hold for control + option");
  });

  test("a rename by layer id reads as a layer", () => {
    expect(historyWords("Renamed layer-3 to Numbers", layout).text).toBe("Renamed a layer to Numbers");
  });

  test("a new legend-named summary splits into cap, layer and change", () => {
    expect(historyWords("Back to: The F key on Base: F17", layout)).toEqual({ how: "Went back", cap: "F", layer: "Base", text: "F17" });
  });

  test("a change from the chat keeps its words, with old key numbers read away", () => {
    expect(historyWords("Key 19 on Layer 0 (R) becomes a hold-tap, tap for R, hold for option.", layout, "agent").text).toBe("The R key on Layer 0 becomes a hold-tap, tap for R, hold for option.");
    expect(historyWords("The left thumb key becomes a plain Option. Option is then a press.", layout, "agent").text).toBe("The left thumb key becomes a plain Option. Option is then a press.");
  });

  test("a swap is two caps and its layer", () => {
    expect(historyWords("Swapped Layer 0 (I) and Layer 0 (T)", layout)).toEqual({ how: null, cap: null, layer: "Layer 0", text: "Swapped", swap: ["I", "T"] });
    expect(historyWords("Swapped A on Base and 4 on Numbers", layout)).toMatchObject({ layer: "Base and Numbers", swap: ["A", "4"] });
  });

  test("anything else keeps its words", () => {
    expect(historyWords("Read colours and tap dances from the Oryx code", layout)).toEqual({ how: null, cap: null, layer: null, text: "Read colours and tap dances from the Oryx code" });
  });
});
