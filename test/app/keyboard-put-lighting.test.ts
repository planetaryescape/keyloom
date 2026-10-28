// A Moonlander layout's RGB keys on the Glove80 (D-453). The Glove80's firmware has underglow controls, recorded as `lightingControls`,
// so its RGB keys come across as `&rgb_ug` keys; per-key colours still don't (D-190). The Corne has no such evidence, so it refuses
// them with the existing sentence. The fixture is the synchronized Oryx export: three of its RGB keys are lighting controls
// (RGB_MODE_FORWARD, RGB_TOG, RGB_HUD); its RGB_SLD is a custom keycode keyloom refuses as QMK-only code, whatever the board.
import { describe, expect, test } from "bun:test";
import { applyChange, getLayout, importLayout, listChanges, openApp } from "../../src/app/index.ts";
import { putConfig } from "../../src/app/keyboard-put.ts";
import type { Binding } from "../../src/layout/schema.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

const isRgb = (b: Binding): boolean => b.kind === "native" && /RGB_|rgb_ug/.test(b.source);

function world() {
  const app = openApp({ dataDir: tempDir() });
  return importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "my-moonlander" }).then((moon) => ({ app, moon }));
}

describe("keyboard put: RGB keys follow the board's lighting evidence (D-453)", () => {
  test("the Glove80 carries the Moonlander's RGB keys as its own &rgb_ug keys, and says nothing about lighting controls", async () => {
    const { app, moon } = await world();
    expect(sourceCount(app, moon.layoutId)).toBe(4);
    const out = putConfig(app, { from: moon.layoutId, board: "moergo/glove80", name: "Moonlander on Glove80" });
    expect(out.notCarried.filter((n) => /lighting controls/.test(n.why))).toEqual([]);
    applyChange(app, out.proposals[0]!.changeSetId);
    const carried = getLayout(app, out.config.id).document.layers.flatMap((l) => l.bindings).filter(isRgb).map((b) => (b.kind === "native" ? b.source : ""));
    expect(carried.sort()).toEqual(["&rgb_ug RGB_EFF", "&rgb_ug RGB_HUD", "&rgb_ug RGB_TOG"]);
    expect(listChanges(app, out.config.id).every((c) => c.validation.ok)).toBe(true);
  });

  test("per-key colours stay refused on the Glove80 with its own sentence, though its RGB keys carry (D-190)", async () => {
    const { app, moon } = await world();
    const out = putConfig(app, { from: moon.layoutId, board: "moergo/glove80", name: "Moonlander on Glove80" });
    expect(out.notes.some((n) => n.startsWith("LED colours were not carried: Glove80 can't show per-key hardware LED colours because its lights are ZMK underglow"))).toBe(true);
  });

  test("the Corne has no lighting evidence, so the same RGB keys are refused with the existing controls sentence", async () => {
    const { app, moon } = await world();
    const out = putConfig(app, { from: moon.layoutId, board: "foostan/corne", name: "Moonlander on Corne" });
    const refused = out.notCarried.filter((n) => /lighting controls/.test(n.why));
    expect(refused).toHaveLength(3);
    expect(refused[0]?.why).toContain("keyloom can't tell that the Corne's firmware has lighting controls, because nothing in this config uses them");
  });
});

const sourceCount = (app: ReturnType<typeof openApp>, layoutId: string): number => getLayout(app, layoutId).document.layers.flatMap((l) => l.bindings).filter(isRgb).length;
