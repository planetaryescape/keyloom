// A put that the validator refuses must not leave a config behind: before this, the config was made first and the proposals after it, so a
// refused mapping left a blank board on the person's screen with no proposals and no way to retry under the same name (D-336).
import { afterEach, describe, expect, test } from "bun:test";
import { getLayout, importLayout, listConfigs } from "../../src/app/index.ts";
import { putConfig } from "../../src/app/keyboard-put.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { type SyncWorld, syncWorld } from "../helpers/fake-sync.ts";
import { reviewActivities } from "../../src/persistence/review-workloads.ts";

let current: SyncWorld | undefined;
afterEach(async () => {
  await current?.stopAll();
  current = undefined;
});

describe("a put the validator refuses", () => {
  test("the new board remembers only the explicitly selected review activities", async () => {
    current = await syncWorld();
    const out = putConfig(current.app, { from: current.layoutId, board: "foostan/corne", reviewActivities: ["shortcuts", "prose"] });
    expect(reviewActivities(current.app.db, out.config.id)).toEqual(["prose", "shortcuts"]);
    expect(reviewActivities(current.app.db, current.layoutId)).toEqual([]);
    expect(current.calls.flashes).toEqual([]);
    expect(current.calls.builds).toEqual([]);
  });
  test("leaves no config behind, so the same put can be tried again", async () => {
    current = await syncWorld();
    const w = current;
    // A Corne key that holds a layer and taps a modified key. Put onto the Moonlander (QMK) it becomes a hold-tap tapping a modified key,
    // which QMK cannot do: the mapping BK tried from his Corne config to the Moonlander.
    const corne = await importLayout(w.app, { board: "foostan/corne", source: "test/fixtures/zmk/corne" });
    const document = structuredClone(getLayout(w.app, corne.layoutId).document);
    const profile = document.holdTapProfiles[0]?.id ?? "mod-tap";
    if (document.holdTapProfiles.length === 0) document.holdTapProfiles.push({ id: profile, name: "Mod-tap", firmware: "zmk", options: {} });
    // The ZMK layer-hold on LA(SPACE) as the importer reads it: hold for a layer, tap a modified space. QMK refuses that as a hold-tap.
    document.layers[0]!.bindings[26] = {
      kind: "holdTap", tap: { code: "SPACE", mods: ["RCTL", "RSFT", "RALT", "RGUI"] }, hold: { layerId: document.layers[1]?.id ?? "layer-1" }, profileId: profile,
    };
    const created = createLayout(w.app.db, { name: "Corne with a modified layer-hold", layout: document, summary: "test", origin: "import" });
    const before = listConfigs(w.app, { includeArchived: true }).length;

    expect(() => putConfig(w.app, { from: created.layout.id, board: "zsa/moonlander" })).toThrow();

    expect(listConfigs(w.app, { includeArchived: true }).length).toBe(before);
  });
});
