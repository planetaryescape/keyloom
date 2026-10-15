import { describe, expect, test } from "bun:test";
import { closeApp, importLayout, openApp, parseBindingExpression } from "../../src/app/index.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

async function moonlander() {
  const app = openApp({ dataDir: tempDir() });
  const out = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
  return { app, ref: out.layoutId };
}

describe("parseBindingExpression (QMK, the editor's Any field)", () => {
  test("LCTL_T(KC_A) is a mod-tap on a profile the layout has", async () => {
    const { app, ref } = await moonlander();
    const out = await parseBindingExpression(app, ref, { expression: "LCTL_T(KC_A)" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.native).toBe(false);
    expect(out.binding).toMatchObject({ kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LCTL"] } });
    const profileId = out.binding.kind === "holdTap" ? out.binding.profileId : "";
    const profiles = (await import("../../src/app/index.ts")).getLayout(app, ref).document.holdTapProfiles.map((p) => p.id);
    expect(profiles).toContain(profileId);
    closeApp(app);
  });

  test("plain keys, layer keys and wrappers map as an import would", async () => {
    const { app, ref } = await moonlander();
    expect((await parseBindingExpression(app, ref, { expression: "KC_A" }))).toMatchObject({ ok: true, binding: { kind: "key", code: "A" } });
    expect((await parseBindingExpression(app, ref, { expression: "MO(1)" }))).toMatchObject({ ok: true, binding: { kind: "layer", action: "momentary" } });
    expect((await parseBindingExpression(app, ref, { expression: "LGUI(KC_C)" }))).toMatchObject({ ok: true, binding: { kind: "key", code: "C", mods: ["LGUI"] } });
    closeApp(app);
  });

  test("an expression keyloom doesn't model is kept as written, native", async () => {
    const { app, ref } = await moonlander();
    const out = await parseBindingExpression(app, ref, { expression: "TD(3)" });
    expect(out).toMatchObject({ ok: true, native: true, binding: { kind: "native", firmware: "qmk", source: "TD(3)" } });
    closeApp(app);
  });

  test("text that is not an expression is refused with a sentence, not kept as a native binding", async () => {
    const { app, ref } = await moonlander();
    for (const expression of ["", "   ", "LCTL_T(KC_A", "hello world", "42"]) {
      const out = await parseBindingExpression(app, ref, { expression });
      expect(out.ok).toBe(false);
    }
    closeApp(app);
  });

  test("a layer number past the last layer is native, not a binding that points nowhere", async () => {
    const { app, ref } = await moonlander();
    const out = await parseBindingExpression(app, ref, { expression: "MO(99)" });
    expect(out).toMatchObject({ ok: true, native: true });
    closeApp(app);
  });
});

describe("parseBindingExpression (ZMK)", () => {
  async function glove80() {
    const app = openApp({ dataDir: tempDir() });
    const out = await importLayout(app, { board: "moergo/glove80", source: "test/fixtures/zmk/glove80-template/glove80.keymap" });
    return { app, ref: out.layoutId };
  }

  test("&mt LCTRL A is a mod-tap on a profile the layout has; the leading & is optional", async () => {
    const { app, ref } = await glove80();
    for (const expression of ["&mt LCTRL A", "mt LCTRL A"]) {
      const out = await parseBindingExpression(app, ref, { expression });
      expect(out).toMatchObject({ ok: true, native: false, binding: { kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LCTL"] } } });
    }
    closeApp(app);
  });

  test("a behaviour keyloom doesn't model is native, and two bindings are refused", async () => {
    const { app, ref } = await glove80();
    expect(await parseBindingExpression(app, ref, { expression: "&caps_word" })).toMatchObject({ ok: true, native: true });
    expect((await parseBindingExpression(app, ref, { expression: "&kp A &kp B" })).ok).toBe(false);
    expect((await parseBindingExpression(app, ref, { expression: "" })).ok).toBe(false);
    closeApp(app);
  });
});
