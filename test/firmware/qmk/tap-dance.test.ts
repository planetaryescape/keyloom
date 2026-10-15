// Tap dance on QMK: the generator writes Oryx's state machine, and the importer reads Oryx's (S16, D-150..D-153).
import { describe, expect, test } from "bun:test";
import { importOryxSource, importQmkSource } from "../../../src/firmware/qmk/import.ts";
import { generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import type { Binding, Layout, Macro, TapDance } from "../../../src/layout/schema.ts";
import { FIXTURE_DIR, moonlander } from "../../helpers/board.ts";

const board = await moonlander();
const imported = await importOryxSource(FIXTURE_DIR, board.definition);
const base = imported.layout;
const gen = (l: Layout) => generateQmkSource({ layout: l, board: board.definition, revisionId: "rev_TEST" });
const text = (l: Layout, name: string) => gen(l).files.find((f) => f.path === name)?.content ?? "";

const key = (code: string, mods?: Array<"LSFT" | "LCTL">): TapDance["tap"] => ({ kind: "key", code, ...(mods ? { mods } : {}) });
const escCaps: TapDance = { id: "esc-caps", name: "Esc, Caps Lock on double-tap", tap: key("ESCAPE"), doubleTap: key("CAPS_LOCK") };
const withDance = (l: Layout, td: TapDance, position = 0): Layout => ({
  ...l,
  tapDances: [...l.tapDances, td],
  layers: l.layers.map((layer, i) =>
    i === 0 ? { ...layer, bindings: layer.bindings.map((b, p): Binding => (p === position ? { kind: "tapDance", tapDanceId: td.id } : b)) } : layer,
  ),
});
/** What the importer can't remember about a generated dance: its id and name become DANCE_n's. */
const slots = (t: TapDance) => ({ tap: t.tap, hold: t.hold, doubleTap: t.doubleTap, tapThenHold: t.tapThenHold, termMs: t.termMs });
const reimport = async (l: Layout) => {
  const files = gen(l).files;
  const get = (n: string) => files.find((f) => f.path === n)?.content;
  const optional = (key: "configH" | "rulesMk" | "keymapJson", file: string) => (get(file) === undefined ? {} : { [key]: get(file) as string });
  return importQmkSource({ name: "t", keymapC: get("keymap.c") as string, ...optional("configH", "config.h"), ...optional("rulesMk", "rules.mk"), ...optional("keymapJson", "keymap.json") }, board.definition);
};

describe("generating tap dances", () => {
  test("Esc tapped, Caps Lock double-tapped is Oryx's state machine around the two keys", () => {
    const l = withDance(base, escCaps);
    const c = text(l, "keymap.c");
    expect(c).toContain("enum tap_dance_codes {\n  DANCE_0,\n  DANCE_1,\n  DANCE_2,\n};");
    expect(c).toContain("static tap dance_state[3];");
    expect(c).toContain("case SINGLE_TAP: register_code16(KC_ESCAPE); break;");
    expect(c).toContain("case DOUBLE_TAP: register_code16(KC_CAPS_LOCK); break;");
    expect(c).toContain("case DOUBLE_SINGLE_TAP: tap_code16(KC_ESCAPE); register_code16(KC_ESCAPE);");
    expect(c).toContain("[DANCE_2] = ACTION_TAP_DANCE_FN_ADVANCED(on_dance_2, dance_2_finished, dance_2_reset),");
    // On the key itself, in the keymap.
    expect(c.split("\n").find((line) => line.includes("TD(DANCE_2)"))).toBeDefined();
    expect(text(l, "rules.mk")).toContain("TAP_DANCE_ENABLE = yes");
  });

  test("a layout with no tap dances writes none, and turns TAP_DANCE_ENABLE off if rules.mk had it on", () => {
    const none: Layout = {
      ...base,
      tapDances: [],
      layers: base.layers.map((layer) => ({ ...layer, bindings: layer.bindings.map((b): Binding => (b.kind === "tapDance" ? { kind: "none" } : b)) })),
      passthrough: base.passthrough.filter((p) => !p.anchor.startsWith("tap-dance")),
    };
    expect(text(none, "keymap.c")).not.toContain("tap_dance");
    expect(text(none, "rules.mk").trimEnd().endsWith("TAP_DANCE_ENABLE = no")).toBe(true);
  });

  test("every slot kind is written, and the term goes to get_tapping_term for the dance's own keycode", () => {
    const macro: Macro = { id: "greet", name: "Greeting", steps: [{ op: "text", text: "Hi!" }] };
    const full: TapDance = {
      id: "all-slots", name: "All slots", tap: key("A"), hold: { kind: "modifier", mods: ["LSFT"] },
      doubleTap: { kind: "layer", action: "toggle", layerId: "layer-1" }, tapThenHold: { kind: "macro", macroId: "greet" }, termMs: 180,
    };
    const c = text(withDance({ ...base, macros: [...base.macros, macro] }, full), "keymap.c");
    expect(c).toContain("case SINGLE_HOLD: register_code16(KC_LEFT_SHIFT); break;");
    expect(c).toContain("case DOUBLE_TAP: layer_invert(1); break;");
    expect(c).toContain('case DOUBLE_HOLD: SEND_STRING("Hi!"); break;');
    expect(c).toContain("case TD(DANCE_2): return 180;");
    expect(c).toContain("default: return TAPPING_TERM;");
    expect(text(withDance({ ...base, macros: [...base.macros, macro] }, full), "config.h")).toContain("#define TAPPING_TERM_PER_KEY");
  });

  test("a macro slot that doesn't exist, or a layer that doesn't, is a clear error and not bad C", () => {
    expect(() => gen(withDance(base, { ...escCaps, doubleTap: { kind: "macro", macroId: "nope" } }))).toThrow(/tap dance "Esc, Caps Lock on double-tap".*"nope"/);
    expect(() => gen(withDance(base, { ...escCaps, hold: { kind: "layer", action: "momentary", layerId: "nowhere" } }))).toThrow(/nowhere/);
  });

  test("a tap dance beside Oryx tap dance code that couldn't be read is refused with the reason", async () => {
    const files = { name: "t", keymapC: await Bun.file(`${FIXTURE_DIR}/keymap.c`).text() };
    // A third step in dance 1 is something the generator would not write back.
    const edited = files.keymapC.replace("case DOUBLE_TAP: register_code16(KC_RBRC); break;", "case DOUBLE_TAP: register_code16(KC_RBRC); register_code16(KC_A); break;");
    const r = await importQmkSource({ ...files, keymapC: edited }, board.definition);
    expect(r.layout.tapDances).toEqual([]);
    expect(() => gen(withDance(r.layout, escCaps))).toThrow(/couldn't read/);
  });
});

describe("macros with text steps", () => {
  test("a text step is a C string literal in SEND_STRING, escaped, between the other steps", () => {
    const macro: Macro = {
      id: "typed", name: "Typed",
      steps: [{ op: "tap", code: "C", mods: ["LGUI"] }, { op: "text", text: 'Thanks, "BK"!\n\tC:\\' }, { op: "waitMs", ms: 50 }, { op: "text", text: "ok" }],
    };
    const c = text({ ...base, macros: [...base.macros, macro] }, "keymap.c");
    expect(c).toContain('SEND_STRING(SS_LGUI(SS_TAP(X_C)) "Thanks, \\"BK\\"!\\n\\tC:\\\\" SS_DELAY(50) "ok");');
  });

  test("a character that can't be typed stops the build with the macro's name and the character", () => {
    const macro: Macro = { id: "typed", name: "Typed", steps: [{ op: "text", text: "naïve" }] };
    expect(() => gen({ ...base, macros: [...base.macros, macro] })).toThrow(/macro "Typed": "ï" can't be typed/);
  });

  test("the text comes back as the same step", async () => {
    const macro: Macro = { id: "st-macro-4", name: "ST_MACRO_4", steps: [{ op: "text", text: 'Thanks, "BK"!\n\tC:\\' }, { op: "waitMs", ms: 50 }, { op: "tap", code: "A" }] };
    const again = await reimport({ ...base, macros: [...base.macros, macro] });
    expect(again.layout.macros.at(-1)).toEqual(macro);
  });
});

describe("what the output depends on", () => {
  test("the same layout generates the same bytes, and a key's dance is its slots, not its place in the list", async () => {
    const full: TapDance = { id: "zz", name: "ZZ", tap: key("A"), hold: { kind: "modifier", mods: ["LSFT"] }, doubleTap: key("B") };
    const l = withDance(withDance(base, escCaps, 0), full, 1);
    expect(gen(structuredClone(l))).toEqual(gen(l));
    const reordered: Layout = { ...l, tapDances: [...l.tapDances].reverse() };
    const slotsAt = async (layout: Layout, position: number) => {
      const again = (await reimport(layout)).layout;
      const b = again.layers[0]?.bindings[position];
      return b?.kind === "tapDance" ? slots(again.tapDances.find((t) => t.id === b.tapDanceId) as TapDance) : undefined;
    };
    for (const position of [0, 1, 34, 35]) expect(await slotsAt(reordered, position)).toEqual(await slotsAt(l, position));
    expect(await slotsAt(l, 1)).toMatchObject({ hold: { kind: "modifier", mods: ["LSFT"] } });
  });
});

describe("importing tap dances", () => {
  test("BK's TD0 and TD1 are tap dances with a tap and a double-tap, and no tap dance code is left as passthrough", () => {
    const none = { hold: undefined, tapThenHold: undefined, termMs: undefined };
    expect(base.tapDances.map(slots)).toEqual([
      { ...none, tap: { kind: "key", code: "SPACE", mods: ["LCTL", "LSFT", "LALT", "LGUI"] }, doubleTap: key("LEFT_BRACKET") },
      { ...none, tap: { kind: "key", code: "SPACE", mods: ["LALT"] }, doubleTap: key("RIGHT_BRACKET") },
    ]);
    expect(base.passthrough.filter((p) => p.anchor.startsWith("tap-dance"))).toEqual([]);
    expect(imported.report.tapDances).toEqual(["Tap dance 0", "Tap dance 1"]);
    expect(imported.report.warnings).toEqual([]);
  });

  test("import, generate, import again gives equal models", async () => {
    const again = await reimport(base);
    expect(again.layout.tapDances).toEqual(base.tapDances);
    expect(again.layout).toEqual(base);
  });

  test("every slot, the term and the keys that use them survive a round trip", async () => {
    const macro: Macro = { id: "st-macro-9", name: "ST_MACRO_9", steps: [{ op: "text", text: "Hi!" }] };
    const full: TapDance = {
      id: "dance-2", name: "Tap dance 2", tap: key("A"), hold: { kind: "layer", action: "momentary", layerId: "layer-1" },
      doubleTap: { kind: "layer", action: "toggle", layerId: "layer-2" }, tapThenHold: { kind: "macro", macroId: "st-macro-9" }, termMs: 180,
    };
    const l = withDance({ ...base, macros: [...base.macros, macro] }, full);
    const again = await reimport(l);
    expect(again.report.warnings).toEqual([]);
    expect(again.layout.tapDances.map(slots)).toEqual(l.tapDances.map(slots));
    expect(again.layout.layers[0]?.bindings[0]).toEqual({ kind: "tapDance", tapDanceId: "dance-2" });
    expect(again.report.warnings).toEqual([]);
  });

  test("tap-hold wrappers: the same key written with its modifiers nested the other way round is read as the same key", async () => {
    const src = await Bun.file(`${FIXTURE_DIR}/keymap.c`).text();
    const nested = src.replaceAll("LALT(LCTL(LGUI(LSFT(KC_SPACE))))", "LSFT(LGUI(LCTL(LALT(KC_SPACE))))");
    const r = await importQmkSource({ name: "t", keymapC: nested }, board.definition);
    expect(r.layout.tapDances.map(slots)).toEqual(base.tapDances.map(slots));
  });

  test("a different key in the code than the model would write, or one extra step, stays native", async () => {
    const src = await Bun.file(`${FIXTURE_DIR}/keymap.c`).text();
    for (const [from, to] of [
      ["case DOUBLE_TAP: register_code16(KC_LBRC); break;", "case DOUBLE_TAP: register_code16(KC_LBRC); wait_ms(5); break;"],
      ["tap_code16(LALT(KC_SPACE));\n        tap_code16(LALT(KC_SPACE));\n        tap_code16(LALT(KC_SPACE));", "tap_code16(LALT(KC_SPACE));\n        tap_code16(LALT(KC_SPACE));"],
      ["wait_ms(10);\n    switch (dance_state[1].step) {", "wait_ms(20);\n    switch (dance_state[1].step) {"],
    ] as const) {
      expect(src).toContain(from);
      const r = await importQmkSource({ name: "t", keymapC: src.replace(from, to) }, board.definition);
      expect({ edit: to, dances: r.layout.tapDances }).toEqual({ edit: to, dances: [] });
      expect(r.layout.layers[0]?.bindings[34]).toMatchObject({ kind: "native", source: "TD(DANCE_0)" });
      expect(r.layout.passthrough.some((p) => p.anchor === "tap-dance")).toBe(true);
      expect(r.report.warnings.join("\n")).toContain("tap dance code kept as written");
    }
  });
});
