// The same search on a ZMK layout (the Glove80's test keymap): flavors and positional hold are ZMK's words for what QMK spells as flags,
// and chordal hold there is two profiles, one per hand, with the keys rebound. The ops must be ones the validator accepts.
import { describe, expect, test } from "bun:test";
import { loadBoardDir } from "../../src/boards/load.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { analyse } from "../../src/lab/analyse.ts";
import type { Passage } from "../../src/lab/passage-types.ts";
import { applyOps } from "../../src/layout/apply-ops.ts";
import { validate } from "../../src/validation/validate.ts";
import { type Stroke, eventsOf, letterPositions, modelReplay } from "../helpers/typing-lab.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";

const glove = await loadBoardDir(`${import.meta.dir}/../../boards/moergo/glove80`);
const board = glove.definition;
const imported = (await importZmkSource(STYLE_FIXTURE, board)).layout;
// ZMK's own defaults for a hold-tap that was never tuned: hold-preferred, 200 ms, no positional rule.
const layout = {
  ...imported,
  holdTapProfiles: imported.holdTapProfiles.map((p) => (p.id === "hm" ? { ...p, options: { bindings: "&kp &kp", flavor: "hold-preferred", "tapping-term-ms": 200 } } : p)),
};
const at = letterPositions(layout);
const TEXT = (t: string): Passage => ({ id: "t", title: "t", why: "", steps: [{ kind: "text", text: t }] });

const rolls = (n: number): Stroke[] =>
  Array.from({ length: n }, (_, i): Stroke[] => [
    { position: at.s as number, down: i * 450, up: i * 450 + 260 },
    { position: at.d as number, down: i * 450 + 150, up: i * 450 + 190 },
  ]).flat();

describe("tuning a ZMK hold-tap on a recording", () => {
  test("a hold-preferred home row mod that fires in rolls is fixed by a positional hold, written as one profile per hand", async () => {
    const a = await analyse({ board, layout, passage: TEXT("sd".repeat(6)), events: eventsOf(rolls(6)), replay: modelReplay(board) });
    expect(a.counts.misfireHold).toBe(6);

    const chordal = a.suggestions.find((s) => s.candidate.family === "hm:chordal");
    expect(chordal?.evidence).toMatchObject({ profileId: "hm", before: 6, after: 0, removed: 6, introduced: 0 });
    const upserts = chordal?.ops.filter((o) => o.op === "upsertHoldTapProfile") ?? [];
    expect(upserts.map((o) => (o.op === "upsertHoldTapProfile" ? o.profile.id : ""))).toEqual(["hm-left", "hm-right"]);
    const left = upserts[0];
    expect(left?.op === "upsertHoldTapProfile" && left.profile.options["hold-trigger-key-positions"]).toEqual(board.hands.right);
    // A hold-preferred key is decided when the other key goes down, so the check must not wait for a release (the real build ignores it then).
    expect(left?.op === "upsertHoldTapProfile" && left.profile.options["hold-trigger-on-release"]).toBeUndefined();
    // Every key that used the profile now uses its hand's copy, on every layer.
    const rebinds = chordal?.ops.filter((o) => o.op === "setBinding") ?? [];
    expect(rebinds).toHaveLength(8);
    expect(rebinds.every((o) => o.op === "setBinding" && o.binding.kind === "holdTap" && /^hm-(left|right)$/.test(o.binding.profileId))).toBe(true);

    // The validator accepts it, and applying it and replaying the recording shows what the suggestion says.
    const ops = chordal?.ops ?? [];
    expect(validate(board, layout, ops).ok).toBe(true);
    const fixed = applyOps(layout, ops);
    if (!fixed.ok) throw new Error("ops did not apply");
    const again = await analyse({ board, layout: fixed.layout, passage: TEXT("sd".repeat(6)), events: eventsOf(rolls(6)), replay: modelReplay(board), suggest: false });
    expect(again.counts.misfireHold).toBe(0);
  });

  test("a longer tapping term does not help a hold-preferred key, and the search does not claim it does", async () => {
    const a = await analyse({ board, layout, passage: TEXT("sd".repeat(6)), events: eventsOf(rolls(6)), replay: modelReplay(board) });
    expect(a.suggestions.filter((s) => s.candidate.family === "hm:term")).toEqual([]);
  });

  test("a tap-preferred key whose holds never come is made easier to hold, not split by hand", async () => {
    const holds: Passage = { id: "h", title: "h", why: "", steps: Array.from({ length: 5 }, () => ({ kind: "hold" as const, key: "s", then: "j" })) };
    // S held 150 ms with J inside it: shorter than the term, so a tap-preferred key never holds.
    const slow = {
      ...layout,
      holdTapProfiles: layout.holdTapProfiles.map((p) => (p.id === "hm" ? { ...p, options: { bindings: "&kp &kp", flavor: "tap-preferred", "tapping-term-ms": 300 } } : p)),
    };
    const strokes = Array.from({ length: 5 }, (_, i): Stroke[] => [
      { position: at.s as number, down: i * 600, up: i * 600 + 250 },
      { position: at.j as number, down: i * 600 + 100, up: i * 600 + 220 },
    ]).flat();
    const a = await analyse({ board, layout: slow, passage: holds, events: eventsOf(strokes), replay: modelReplay(board) });
    expect(a.counts.misfireTap).toBe(5);
    expect(a.suggestions.some((s) => s.candidate.family === "hm:chordal")).toBe(false);
    // Making holds easier is the direction, by the term or by the flavor: whichever it finds first that removes all five.
    const best = a.suggestions.find((s) => s.evidence.profileId === "hm");
    expect(best?.evidence).toMatchObject({ before: 5, after: 0, removed: 5, introduced: 0 });
    expect(best?.candidate.title).toMatch(/^(Lower the tapping term of HOMEROW_MODS from 300|Switch HOMEROW_MODS to the balanced)/);
  });
});
