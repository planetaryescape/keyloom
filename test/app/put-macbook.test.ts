// "Put my Glove80 config on this keyboard" onto the MacBook (21#copying-the-other-boards-setup-onto-it, D-383): the put works on a
// software remapper, what kanata or keyloom's output can't say comes back as a note, never a refusal, and the D-247 rules still hold.
import { describe, expect, test } from "bun:test";
import { getLayout, importLayout, listChanges, openApp } from "../../src/app/index.ts";
import { previewPut, putConfig } from "../../src/app/keyboard-put.ts";
import { applyChange } from "../../src/app/index.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";
import { tempDir } from "../helpers/tmp.ts";

const MAC = "apple/macbook-ansi";

async function world() {
  const app = openApp({ dataDir: tempDir() });
  const glove = await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "my-glove80" });
  return { app, glove };
}

describe("a put onto the MacBook keyboard", () => {
  test("makes a new config with proposals the validator accepts, and applying one keeps Escape and Control reachable", async () => {
    const { app, glove } = await world();
    const out = putConfig(app, { from: glove.layoutId, board: MAC });
    expect(out.config.boardName).toContain("MacBook");
    const stored = listChanges(app, out.config.id);
    expect(stored.length).toBeGreaterThanOrEqual(1);
    expect(stored.every((c) => c.status === "proposed" && c.validation.ok)).toBe(true);

    applyChange(app, out.proposals[0]!.changeSetId);
    const doc = getLayout(app, out.config.id).document;
    const base = doc.layers[0]!.bindings;
    const typed = (code: string) => base.some((b) => (b.kind === "key" && b.code === code) || (b.kind === "holdTap" && b.tap.code === code));
    expect(typed("ESCAPE")).toBe(true);
    expect(base.some((b) => (b.kind === "key" && /CTRL$/.test(b.code)) || (b.kind === "modifier" && b.mods.some((m) => m.endsWith("CTL"))) || (b.kind === "holdTap" && "mods" in b.hold && b.hold.mods.some((m) => m.endsWith("CTL"))))).toBe(true);
    // Every layer other than the base has a way back to it: the validator would have refused the apply otherwise.
    expect(doc.layers.length).toBeGreaterThan(1);
  });

  test("what kanata cannot say is a note, not a refusal: the macro that holds a non-modifier is left off and named", async () => {
    const { app, glove } = await world();
    const preview = previewPut(app, { from: glove.layoutId, board: MAC });
    const why = preview.notCarried.map((n) => n.why).join("\n");
    expect(why).toContain("can't be written for kanata");
    expect(preview.summary).toContain("layer");
  });

  test("factory and test layers are left out unless asked for, and the note says so", async () => {
    const { app, glove } = await world();
    const doc = getLayout(app, glove.layoutId).document;
    const extra = { ...doc.layers[1]!, id: "factory-test-layer", name: "factory_test_layer" };
    const withFactory = createLayout(app.db, { name: "glove-with-factory", layout: { ...doc, layers: [...doc.layers, extra] }, summary: "test", origin: "import" });

    const preview = previewPut(app, { from: withFactory.layout.id, board: MAC });
    expect(preview.layers.map((l) => l.target)).not.toContain("factory-test-layer");
    expect(preview.notes.join("\n")).toContain("Left out factory_test_layer: a factory or test layer");
    // Naming it brings it in.
    const all = previewPut(app, { from: withFactory.layout.id, board: MAC, layers: doc.layers.map((l) => l.id).concat("factory-test-layer") });
    expect(all.layers.map((l) => l.target)).toContain("factory-test-layer");
    expect(() => previewPut(app, { from: glove.layoutId, board: MAC, layers: ["nope"] })).toThrow(/no layer called "nope"/);
  });

  test("a tap dance with a hold is left off with a reason that blames keyloom's output, not the keyboard", async () => {
    const { app, glove } = await world();
    const doc = getLayout(app, glove.layoutId).document;
    const at = doc.layers[0]!.bindings.findIndex((b) => b.kind === "key" && /^[A-Z]$/.test(b.code));
    expect(at).toBeGreaterThan(-1);
    const bindings = doc.layers[0]!.bindings.map((b, i) => (i === at ? { kind: "tapDance" as const, tapDanceId: "td-hold" } : b));
    const dance = { id: "td-hold", name: "J or Escape", tap: { kind: "key" as const, code: "A" }, hold: { kind: "key" as const, code: "ESCAPE" } };
    const made = createLayout(app.db, { name: "glove-dance", layout: { ...doc, layers: [{ ...doc.layers[0]!, bindings }, ...doc.layers.slice(1)], tapDances: [dance] }, summary: "test", origin: "import" });

    const preview = previewPut(app, { from: made.layout.id, board: MAC });
    const skipped = preview.notCarried.find((n) => n.why.includes("tap dance"));
    expect(skipped?.why).toContain("keyloom's kanata output only writes tap-counting dances");
    expect(skipped?.why).not.toContain("keyboard can't");
    expect(putConfig(app, { from: made.layout.id, board: MAC }).proposals.length).toBeGreaterThan(0);
  });
});
