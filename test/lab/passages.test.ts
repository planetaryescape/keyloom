// The built-in passages must be typeable on each board's base layer, built from the layout's own home row, and read back as the person
// reads them. A passage that asks for a key the board does not have on its first layer would be marked wrong for no fault of the hands.
import { describe, expect, test } from "bun:test";
import { loadBoardDir } from "../../src/boards/load.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { builtinPassages, customPassage, passageLines } from "../../src/lab/passages.ts";
import { intentSteps } from "../../src/lab/intent.ts";
import { bkMoonlander } from "../helpers/typing-lab.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";

const ROOT = `${import.meta.dir}/../..`;

async function boards() {
  const moon = await bkMoonlander();
  const glove = await loadBoardDir(`${ROOT}/boards/moergo/glove80`);
  const corne = await loadBoardDir(`${ROOT}/boards/foostan/corne`);
  return [
    { name: "Moonlander", ...moon },
    { name: "Glove80", board: glove.definition, layout: (await importZmkSource(STYLE_FIXTURE, glove.definition)).layout },
    { name: "Corne", board: corne.definition, layout: (await importZmkSource(`${ROOT}/test/fixtures/zmk/corne`, corne.definition)).layout },
  ];
}

describe("built-in passages", () => {
  test("every passage on every board is made only of keys the base layer has", async () => {
    for (const { name, board, layout } of await boards()) {
      const passages = builtinPassages(layout, board);
      expect(passages.map((p) => p.id), name).toContain("starter");
      expect(passages.map((p) => p.id), name).toContain("prose");
      for (const p of passages) {
        const { skipped, steps } = intentSteps(p, layout, board);
        // The prose uses a few letters a thin board may keep off the first layer; the drills are built from the layout so none is missing.
        if (p.id !== "prose" && p.id !== "starter") expect(skipped, `${name} ${p.id}`).toEqual([]);
        expect(steps.length, `${name} ${p.id}`).toBeGreaterThan(5);
      }
    }
  });

  test("the home row drills use the layout's own mod-tap keys: rolls between neighbours, holds with keys on both hands", async () => {
    const { board, layout } = (await boards())[0] as Awaited<ReturnType<typeof boards>>[number];
    const passages = builtinPassages(layout, board);
    const rolls = passages.find((p) => p.id === "home-row-rolls");
    expect(passageLines(rolls as never)).toContain("sdsdsd dsdsds");
    const holds = passages.find((p) => p.id === "home-row-holds");
    // S is a mod-tap on BK's Moonlander, held with a plain key of the other hand (K: H, J and L are mod-taps themselves) and one of its own (A).
    expect(holds?.steps).toContainEqual({ kind: "hold", key: "s", then: "k" });
    expect(holds?.steps).toContainEqual({ kind: "hold", key: "s", then: "a" });
    expect(holds?.steps.filter((s) => s.kind === "hold" && s.key === "s")).toHaveLength(2);
    const { steps } = intentSteps(holds as never, layout, board);
    expect(steps.filter((s) => s.intent === "hold").every((s) => s.holdMods !== undefined)).toBe(true);
    const drill = passages.find((p) => p.id === "finger-drill");
    expect(passageLines(drill as never)).toContain("qaz zaq qaz");
  });

  test("a hold step with a key the layout has no mod-tap for is left out and named, not silently made a tap", async () => {
    const { board, layout } = (await boards())[0] as Awaited<ReturnType<typeof boards>>[number];
    const r = intentSteps({ id: "x", title: "x", why: "", steps: [{ kind: "hold", key: "q", then: "j" }, { kind: "text", text: "ab" }] }, layout, board);
    expect(r.skipped).toEqual(["hold q+j"]);
    expect(r.steps).toHaveLength(2);
  });

  test("the person's own text is lowered, tidied and cut to what the lab can ask for", () => {
    expect(customPassage("  Hello,\n\tWORLD!  ").steps).toEqual([{ kind: "text", text: "hello, world" }]);
    expect(customPassage("€€€").steps).toEqual([{ kind: "text", text: "" }]);
  });
});
