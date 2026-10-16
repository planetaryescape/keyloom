// QMK picks a hold-tap's per-key settings by its keycode (hold-tap-rules.ts), so a suggestion that retunes one profile while the same
// mod-tap sits under another profile elsewhere can never be applied. The search must only offer ones that can.
import { describe, expect, test } from "bun:test";
import { analyse } from "../../src/lab/analyse.ts";
import type { Passage } from "../../src/lab/passage-types.ts";
import { search } from "../../src/lab/search.ts";
import { applyOps } from "../../src/layout/apply-ops.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { validate } from "../../src/validation/validate.ts";
import { type Stroke, bkMoonlander, eventsOf, letterPositions, modelReplay } from "../helpers/typing-lab.ts";

const TEXT = (t: string): Passage => ({ id: "t", title: "t", why: "", steps: [{ kind: "text", text: t }] });

const world = await bkMoonlander();
const plain: Layout = {
  ...world.layout,
  settings: world.layout.settings.filter((s) => s.key !== "CHORDAL_HOLD" && s.key !== "PERMISSIVE_HOLD"),
  holdTapProfiles: world.layout.holdTapProfiles.map((p) => ({ ...p, options: {} })),
};
const S = letterPositions(plain).s as number;
const D = letterPositions(plain).d as number;
const homeS = plain.layers[0]?.bindings[S];
if (homeS?.kind !== "holdTap") throw new Error("fixture: S is not a hold-tap");

// The same LALT_T(KC_S) on another layer, under the Mod-tap profile.
const shared: Layout = {
  ...plain,
  layers: plain.layers.map((l, i) => (i === 2 ? { ...l, bindings: l.bindings.map((b, p) => (p === S ? { ...homeS, profileId: "mod-tap" } : b)) } : l)),
};

const rolls: Stroke[] = Array.from({ length: 6 }, (_, i) => [
  { position: S, down: i * 450, up: i * 450 + 260 },
  { position: D, down: i * 450 + 150, up: i * 450 + 190 },
]).flat();
const analyseShared = (layout: Layout) =>
  analyse({ board: world.board, layout, passage: TEXT("sd".repeat(6)), events: eventsOf(rolls), replay: modelReplay(world.board) });

describe("a hold-tap keycode that appears under two profiles", () => {
  test("the layout is valid as it stands, because both profiles agree", () => {
    expect(validate(world.board, shared, []).ok).toBe(true);
  });

  test("every suggestion applies, because the other copy of the keycode moves with it", async () => {
    const a = await analyseShared(shared);
    const term = a.suggestions.find((s) => s.candidate.family.endsWith(":term"));
    expect(term?.candidate.title).toBe("Raise the tapping term of Home-row mods from 200 to 280 ms");
    expect(a.suggestions.length).toBeGreaterThan(0);
    for (const s of a.suggestions) expect(validate(world.board, shared, s.ops).errors).toEqual([]);
    // The other copy is rebound to the profile being tuned, and then agrees with it.
    expect(term?.ops).toContainEqual({ op: "setBinding", at: { layerId: "layer-2", position: S }, binding: { ...homeS, profileId: "home-row-mods" } });
    const fixed = applyOps(shared, term?.ops ?? []);
    if (!fixed.ok) throw new Error("ops did not apply");
    const again = await analyse({ board: world.board, layout: fixed.layout, passage: TEXT("sd".repeat(6)), events: eventsOf(rolls), replay: modelReplay(world.board), suggest: false });
    expect(again.counts.misfireHold).toBe(0);
  });

  test("a layout without a shared keycode gets the same one-op suggestion as before", async () => {
    const a = await analyseShared(plain);
    expect(a.suggestions.find((s) => s.candidate.family.endsWith(":term"))?.ops).toHaveLength(1);
  });
});

describe("the validator guards what the search offers", () => {
  test("a suggestion the validator rejects is dropped and the reason is noted", async () => {
    const model = modelReplay(world.board);
    const a = await analyse({ board: world.board, layout: plain, passage: TEXT("sd".repeat(6)), events: eventsOf(rolls), replay: model, suggest: false });
    const result = await search({
      layout: plain, board: world.board, baseline: a.differences,
      measure: async () => [],
      validateOps: () => [{ code: "firmware_unsupported", message: "synthetic rejection", plain: "synthetic" }],
    });
    expect(result.suggestions).toEqual([]);
    expect(result.notes.join("\n")).toContain("synthetic rejection");
  });
});
