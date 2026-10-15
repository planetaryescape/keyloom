import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { readdirSync } from "node:fs";
import { ImportError, importOryxSource, importQmkSource } from "../../../src/firmware/qmk/import.ts";
import type { SourceFiles } from "../../../src/firmware/qmk/source.ts";
import { FIXTURE_DIR, moonlander } from "../../helpers/board.ts";
import { irDescriptor, loadOracle, oracleDescriptor } from "../../helpers/oryx-oracle.ts";

const board = await moonlander();
const imported = await importOryxSource(FIXTURE_DIR, board.definition);
const { layout, report } = imported;

describe("BK's real Oryx export", () => {
  test("six layers of 72 bindings", () => {
    expect(layout.layers).toHaveLength(6);
    for (const [i, layer] of layout.layers.entries()) {
      expect(layer.bindings).toHaveLength(72);
      expect(layer.id).toBe(`layer-${i}`);
      expect(layer.name).toBe(`Layer ${i}`);
    }
    expect(layout.boardId).toBe("zsa/moonlander");
    expect(layout.firmware).toBe("qmk");
  });

  test("S on the base layer is a home-row hold-tap, S tap and left Alt hold", () => {
    expect(layout.layers[0]?.bindings[30]).toEqual({
      kind: "holdTap",
      tap: { code: "S" },
      hold: { mods: ["LALT"] },
      profileId: "home-row-mods",
    });
  });

  test("mod-taps off the home row use mod-tap; layer-taps use layer-tap", () => {
    expect(layout.layers[0]?.bindings[43]).toMatchObject({ kind: "holdTap", tap: { code: "Z" }, hold: { mods: ["LCTL"] }, profileId: "mod-tap" });
    expect(layout.layers[0]?.bindings[41]).toEqual({
      kind: "holdTap", tap: { code: "QUOTE" }, hold: { layerId: "layer-2" }, profileId: "layer-tap",
    });
    expect(layout.holdTapProfiles.map((p) => p.id)).toEqual(["home-row-mods", "mod-tap", "layer-tap"]);
  });

  test("ALL_T is a hold-tap with all four left mods (Hyper)", () => {
    expect(layout.layers[0]?.bindings[33]).toEqual({
      kind: "holdTap", tap: { code: "G" }, hold: { mods: ["LCTL", "LSFT", "LALT", "LGUI"] }, profileId: "home-row-mods",
    });
  });

  test("KC_HYPR and KC_MEH are modifiers with four and three mods", () => {
    expect(layout.layers[4]?.bindings[34]).toEqual({ kind: "modifier", mods: ["LCTL", "LSFT", "LALT", "LGUI"] });
    expect(layout.layers[4]?.bindings[35]).toEqual({ kind: "modifier", mods: ["LCTL", "LSFT", "LALT"] });
  });

  test("shifted aliases resolve to the base key plus Left Shift", () => {
    expect(layout.layers[1]?.bindings[15]).toEqual({ kind: "key", code: "N1", mods: ["LSFT"] }); // KC_EXLM
    expect(layout.layers[1]?.bindings[46]).toEqual({ kind: "key", code: "LEFT_BRACKET", mods: ["LSFT"] }); // KC_LCBR
    expect(layout.layers[1]?.bindings[43]).toEqual({ kind: "key", code: "GRAVE", mods: ["LSFT"] }); // KC_TILD
  });

  test("modifier wrappers become keys with mods, nested ones keep every mod", () => {
    expect(layout.layers[1]?.bindings[34]).toEqual({ kind: "key", code: "SPACE", mods: ["LCTL", "LSFT", "LALT", "LGUI"] });
    expect(layout.layers[2]?.bindings[33]).toEqual({ kind: "key", code: "N4", mods: ["LSFT", "LGUI"] });
  });

  test("layer actions map by layer id", () => {
    expect(layout.layers[0]?.bindings[55]).toEqual({ kind: "layer", action: "to", layerId: "layer-1" }); // TO(1)
    expect(layout.layers[0]?.bindings[65]).toEqual({ kind: "layer", action: "toggle", layerId: "layer-4" }); // TG(4)
    expect(layout.layers[0]?.bindings[66]).toEqual({ kind: "layer", action: "momentary", layerId: "layer-3" }); // MO(3)
    expect(layout.layers[0]?.bindings[71]).toEqual({ kind: "layer", action: "oneShot", layerId: "layer-1" }); // OSL(1)
  });

  test("DUAL_FUNC_0 and TD() are native with their source kept", () => {
    const base = layout.layers[0]?.bindings;
    expect(base?.[7]).toMatchObject({ kind: "native", firmware: "qmk", source: "DUAL_FUNC_0" });
    expect(base?.[34]).toMatchObject({ kind: "native", source: "TD(DANCE_0)" });
    expect(base?.[35]).toMatchObject({ kind: "native", source: "TD(DANCE_1)" });
    expect(base?.[57]).toMatchObject({ kind: "native", source: "OSM(MOD_LSFT)" });
  });

  test("mouse, RGB and QK_BOOT are native", () => {
    for (const source of ["KC_MS_BTN1", "RGB_TOG", "QK_BOOT", "TOGGLE_LAYER_COLOR", "RGB_SLD"]) {
      expect(report.native.some((n) => n.source === source)).toBe(true);
    }
  });

  test("ST_MACRO_0..3 are macros with the steps from SEND_STRING", () => {
    expect(layout.macros.map((m) => m.name)).toEqual(["ST_MACRO_0", "ST_MACRO_1", "ST_MACRO_2", "ST_MACRO_3"]);
    expect(layout.macros[0]?.steps).toEqual([{ op: "tap", code: "N4", mods: ["LSFT", "LGUI"] }]);
    for (const [i, key] of [[1, "C"], [2, "X"], [3, "V"]] as const) {
      expect(layout.macros[i]?.steps).toEqual([{ op: "tap", code: "LEFT_GUI" }, { op: "waitMs", ms: 100 }, { op: "tap", code: key }]);
    }
    expect(layout.layers[0]?.bindings[56]).toEqual({ kind: "macro", macroId: "st-macro-0" });
  });

  test("all 8 combos resolve to base-layer positions", () => {
    expect(layout.combos).toHaveLength(8);
    expect(layout.combos.map((c) => c.positions)).toEqual([
      [45, 46], [44, 45], [46, 47], [30, 31], [38, 39], [31, 32], [37, 38], [50, 51],
    ]);
    for (const c of layout.combos) expect(c.layerIds).toBe("all");
    expect(layout.combos[0]?.output).toEqual({ kind: "macro", macroId: "st-macro-1" });
    expect(layout.combos[3]?.output).toEqual({ kind: "modifier", mods: ["LSFT"] });
    expect(layout.combos[5]?.output).toEqual({ kind: "key", code: "LEFT_BRACKET", mods: ["LSFT"] });
    expect(layout.combos[7]?.output).toEqual({ kind: "key", code: "MINUS" });
  });

  test("combo positions hold the keys the combo names", () => {
    const base = layout.layers[0]?.bindings ?? [];
    expect(base[45]).toEqual({ kind: "key", code: "C" });
    expect(base[46]).toEqual({ kind: "key", code: "V" });
    expect(base[30]).toMatchObject({ kind: "holdTap", tap: { code: "S" } });
    expect(base[31]).toEqual({ kind: "key", code: "D" });
  });

  test("config.h becomes settings; LAYER_STATE_8BIT is one", () => {
    const get = (key: string) => layout.settings.find((s) => s.key === key);
    expect(get("LAYER_STATE_8BIT")).toEqual({ firmware: "qmk", key: "LAYER_STATE_8BIT", value: true });
    expect(get("CHORDAL_HOLD")?.value).toBe(true);
    expect(get("PERMISSIVE_HOLD")?.value).toBe(true);
    expect(get("RGB_MATRIX_STARTUP_SPD")?.value).toBe(60);
    expect(get("USB_SUSPEND_WAKEUP_DELAY")?.value).toBe(0);
    // COMBO_COUNT follows the combos and SERIAL_NUMBER is kept verbatim, so neither is a setting.
    expect(get("COMBO_COUNT")).toBeUndefined();
    expect(get("SERIAL_NUMBER")).toBeUndefined();
  });

  test("profiles carry the global tap-hold options", () => {
    for (const p of layout.holdTapProfiles) expect(p.options).toEqual({ CHORDAL_HOLD: true, PERMISSIVE_HOLD: true });
  });

  test("passthrough covers the unmodelled code, and flags layer-indexed blocks", () => {
    const byAnchor = new Map(layout.passthrough.map((p) => [`${p.file}:${p.anchor}`, p]));
    const flag = (k: string) => {
      const p = byAnchor.get(k);
      expect(p).toBeDefined();
      return p?.refersToLayerIndices;
    };
    expect(flag("keymap.c:rgb")).toBe(true); // ledmap[], case 1:, set_layer_color(1)
    expect(flag("keymap.c:define:DUAL_FUNC_0")).toBe(true); // LT(5, KC_4)
    expect(flag("keymap.c:process_record_user:DUAL_FUNC_0")).toBe(true); // layer_move(5)
    expect(flag("keymap.c:tap-dance")).toBe(false);
    expect(flag("keymap.c:tap-dance-codes")).toBe(false);
    expect(flag("keymap.c:chordal-hold-layout")).toBe(false);
    expect(flag("keymap.c:process_record_user:RGB_SLD")).toBe(false);
    expect(flag("config.h:define:SERIAL_NUMBER")).toBe(false);
    expect(flag("rules.mk:file")).toBe(false);
    expect(flag("keymap.json:file")).toBe(false);
    expect(byAnchor.get("config.h:define:SERIAL_NUMBER")?.source).toBe('#define SERIAL_NUMBER "QxKPz/zLQ3Md"');
    expect(byAnchor.get("keymap.json:file")?.source).toContain("zsa/oryx");
    // the macro cases are modelled, so they are not also kept as source
    expect([...byAnchor.keys()].some((k) => k.includes("ST_MACRO"))).toBe(false);
  });

  test("passthrough source is verbatim", () => {
    const dance = layout.passthrough.find((p) => p.anchor === "tap-dance");
    expect(dance?.source.startsWith("typedef struct {")).toBe(true);
    expect(dance?.source.endsWith("};")).toBe(true);
    const codes = layout.passthrough.find((p) => p.anchor === "tap-dance-codes");
    expect(codes?.source).toBe("enum tap_dance_codes {\n  DANCE_0,\n  DANCE_1,\n};");
    const chordal = layout.passthrough.find((p) => p.anchor === "chordal-hold-layout");
    expect(chordal?.source).toContain("PROGMEM");
    expect(chordal?.source).toMatch(/\);$/);
  });

  test("the report counts bindings by kind and lists every native and passthrough item", () => {
    const total = Object.values(report.bindings).reduce((a, b) => a + b, 0);
    expect(total).toBe(6 * 72);
    expect(report.bindings.native).toBe(report.native.length);
    expect(report.layers).toBe(6);
    expect(report.keysPerLayer).toBe(72);
    expect(report.passthrough).toHaveLength(layout.passthrough.length);
    expect(report.macros).toHaveLength(4);
    expect(report.combos).toBe(8);
    expect(report.warnings).toEqual([]);
    expect(imported.suggestedName).toBe("synchronized");
  });
});

describe("agreement with Oryx's own decoding (GraphQL oracle)", () => {
  // Oryx lists keys left half then right half, each row by row, which is not LAYOUT order (rows
  // across both halves). Within the right half's fifth row Oryx puts the inner 2u key last. This
  // table is that order, written out; the content check below is what proves it (432 keys that
  // differ from one another would not line up by accident).
  const oryxOrder = [
    ...[0, 1, 2, 3, 4, 5, 6], ...[14, 15, 16, 17, 18, 19, 20], ...[28, 29, 30, 31, 32, 33, 34],
    ...[42, 43, 44, 45, 46, 47], ...[54, 55, 56, 57, 58, 59], ...[66, 67, 68],
    ...[7, 8, 9, 10, 11, 12, 13], ...[21, 22, 23, 24, 25, 26, 27], ...[35, 36, 37, 38, 39, 40, 41],
    ...[48, 49, 50, 51, 52, 53], ...[61, 62, 63, 64, 65, 60], ...[69, 70, 71],
  ];

  test("Oryx has the same six layers of 72 keys", async () => {
    const oracle = await loadOracle();
    expect(oracle).toHaveLength(6);
    for (const l of oracle) expect(l.keys).toHaveLength(72);
    expect(oryxOrder).toHaveLength(72);
    expect(new Set(oryxOrder).size).toBe(72);
  });

  test("Oryx's order is not LAYOUT order, and the halves are the board's hands", () => {
    expect(oryxOrder).not.toEqual(Array.from({ length: 72 }, (_, i) => i));
    expect(oryxOrder.slice(0, 36).sort((a, b) => a - b)).toEqual([...board.definition.hands.left].sort((a, b) => a - b));
    expect(oryxOrder.slice(36).sort((a, b) => a - b)).toEqual([...board.definition.hands.right].sort((a, b) => a - b));
  });

  test("layer titles are truncated to eight characters by Oryx's API, so they are not used as names", async () => {
    const oracle = await loadOracle();
    expect(oracle.map((l) => l.title)).toEqual(["Base", "Number", "Navigati", "Mouse", "Colemac", "Gaming"]);
  });

  test("every key of every layer agrees", async () => {
    const oracle = await loadOracle();
    const mismatches: string[] = [];
    for (const [li, layer] of layout.layers.entries()) {
      oracle[li]?.keys.forEach((oryxKey, i) => {
        const position = oryxOrder[i] as number;
        const want = oracleDescriptor(oryxKey);
        const got = irDescriptor(layer.bindings[position] as never, layout);
        if (want !== got) mismatches.push(`layer ${li} position ${position}: oryx ${want} vs keyloom ${got}`);
      });
    }
    expect(mismatches).toEqual([]);
  });

  test("the keys outside the model (DUAL_FUNC_0, TD) match Oryx's decoding of the code kept as source", async () => {
    const oracle = await loadOracle();
    const at = (position: number) => oracle[0]?.keys[oryxOrder.indexOf(position)];
    // DUAL_FUNC_0: Oryx shows tap F5 / hold TO(5); the kept case sends F5 on tap and layer_move(5) on hold.
    expect(at(7)?.tap?.code).toBe("KC_F5");
    expect(at(7)?.hold).toMatchObject({ code: "TO", layer: 5 });
    const duel = layout.passthrough.find((p) => p.anchor === "process_record_user:DUAL_FUNC_0")?.source ?? "";
    expect(duel).toContain("register_code16(KC_F5)");
    expect(duel).toContain("layer_move(5)");
    // TD(DANCE_0): Oryx shows tap Hyper+Space / double tap [; TD(DANCE_1): Alt+Space / ].
    expect(at(34)?.doubleTap?.code).toBe("KC_LBRC");
    expect(at(35)?.doubleTap?.code).toBe("KC_RBRC");
    const dance = layout.passthrough.find((p) => p.anchor === "tap-dance")?.source ?? "";
    expect(dance).toContain("case SINGLE_TAP: register_code16(LALT(LCTL(LGUI(LSFT(KC_SPACE)))))");
    expect(dance).toContain("case DOUBLE_TAP: register_code16(KC_LBRC)");
    expect(dance).toContain("case DOUBLE_TAP: register_code16(KC_RBRC)");
  });
});

describe("inputs", () => {
  const fixtureFiles = () => {
    const out: Record<string, Uint8Array> = {};
    for (const f of readdirSync(FIXTURE_DIR)) {
      if (["keymap.c", "config.h", "rules.mk", "keymap.json"].includes(f)) out[`zsa_moonlander_synchronized_source/${f}`] = Bun.file(`${FIXTURE_DIR}/${f}`).bytes() as never;
    }
    return out;
  };

  test("an Oryx zip imports the same layout as the unpacked folder", async () => {
    const entries: Record<string, Uint8Array> = {};
    for (const [name, bytes] of Object.entries(fixtureFiles())) entries[name] = await (bytes as unknown as Promise<Uint8Array>);
    // The real download also holds the prebuilt firmware; it must not be read.
    entries["zsa_moonlander_reva_QxKPz.bin"] = new Uint8Array(200_000).fill(7);
    entries["README.md"] = new TextEncoder().encode("hello");
    const dir = `${import.meta.dir}/../../../.tmp-zip-test`;
    await Bun.write(`${dir}/oryx.zip`, zipSync(entries));
    try {
      const fromZip = await importOryxSource(`${dir}/oryx.zip`, board.definition);
      expect(fromZip.suggestedName).toBe("synchronized");
      expect(fromZip.layout).toEqual(layout);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("the parent of the unpacked source folder works too", async () => {
    const dir = `${import.meta.dir}/../../../.tmp-parent-test`;
    await Bun.$`mkdir -p ${dir}/zsa_moonlander_synchronized_source && cp ${FIXTURE_DIR}/keymap.c ${dir}/zsa_moonlander_synchronized_source/`.quiet();
    try {
      const r = await importOryxSource(dir, board.definition);
      expect(r.layout.layers).toHaveLength(6);
      expect(r.suggestedName).toBe("synchronized");
      expect(r.report.warnings.some((w) => w.includes("no config.h"))).toBe(true);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("a missing path, a non-zip file and a folder without keymap.c are import errors", async () => {
    await expect(importOryxSource("/nonexistent/oryx", board.definition)).rejects.toThrow(ImportError);
    await expect(importOryxSource(`${FIXTURE_DIR}/config.h`, board.definition)).rejects.toThrow(ImportError);
    await expect(importOryxSource(`${FIXTURE_DIR}/..`, board.definition)).rejects.toThrow(ImportError);
  });

  test("parallel imports share one parser and agree", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => importOryxSource(FIXTURE_DIR, board.definition)));
    for (const r of results) expect(r.layout).toEqual(layout);
  });
});

describe("tolerance and failure", () => {
  const base = async (): Promise<SourceFiles> => ({
    name: "t",
    keymapC: await Bun.file(`${FIXTURE_DIR}/keymap.c`).text(),
    configH: await Bun.file(`${FIXTURE_DIR}/config.h`).text(),
  });

  test("an unknown keycode imports as native instead of failing", async () => {
    const files = await base();
    const r = await importQmkSource({ ...files, keymapC: files.keymapC.replace("KC_F16,", "KC_DEFINITELY_NOT_REAL,") }, board.definition);
    expect(r.layout.layers[0]?.bindings[6]).toMatchObject({ kind: "native", source: "KC_DEFINITELY_NOT_REAL" });
    expect(r.report.native.some((n) => n.source === "KC_DEFINITELY_NOT_REAL")).toBe(true);
  });

  test("names that collide with Object.prototype are plain unknown keycodes", async () => {
    const files = await base();
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      const keymapC = files.keymapC.replace("KC_F16,", `${name},`).replace("MO(3),", `${name}_T(KC_A),`);
      const r = await importQmkSource({ ...files, keymapC }, board.definition);
      expect(r.layout.layers[0]?.bindings[6]).toMatchObject({ kind: "native", source: name });
      expect(r.layout.layers[0]?.bindings[66]).toMatchObject({ kind: "native" });
    }
  });

  test("a wrapper around an unknown keycode is native, not a key", async () => {
    const files = await base();
    const r = await importQmkSource({ ...files, keymapC: files.keymapC.replace("KC_F16,", "LGUI(KC_NOPE),") }, board.definition);
    expect(r.layout.layers[0]?.bindings[6]).toMatchObject({ kind: "native", source: "LGUI(KC_NOPE)" });
  });

  test("a hold-tap whose tap side is unknown is native", async () => {
    const files = await base();
    const r = await importQmkSource({ ...files, keymapC: files.keymapC.replace("KC_F16,", "MT(MOD_LALT, KC_NOPE),") }, board.definition);
    expect(r.layout.layers[0]?.bindings[6]).toMatchObject({ kind: "native" });
  });

  test("a layer reference past the last layer is native", async () => {
    const files = await base();
    const r = await importQmkSource({ ...files, keymapC: files.keymapC.replace("KC_F16,", "MO(9),") }, board.definition);
    expect(r.layout.layers[0]?.bindings[6]).toMatchObject({ kind: "native", source: "MO(9)" });
  });

  test("MT with several modifiers and a negative layer number do not crash", async () => {
    const files = await base();
    const keymapC = files.keymapC.replace("KC_F16,", "MT(MOD_LCTL | MOD_LSFT, KC_A),").replace("MO(3),", "MO(-1),");
    const r = await importQmkSource({ ...files, keymapC }, board.definition);
    expect(r.layout.layers[0]?.bindings[6]).toMatchObject({ kind: "holdTap", hold: { mods: ["LCTL", "LSFT"] } });
    expect(r.layout.layers[0]?.bindings[66]).toMatchObject({ kind: "native" });
  });

  test("a layer with the wrong number of keys names the layer", async () => {
    const files = await base();
    await expect(importQmkSource({ ...files, keymapC: files.keymapC.replace("KC_F16,", "") }, board.definition)).rejects.toThrow(/layer 0 has 71 keys/);
  });

  test("a keymap.c without keymaps[] is an import error", async () => {
    await expect(importQmkSource({ name: "t", keymapC: "int main(void) { return 0; }" }, board.definition)).rejects.toThrow(ImportError);
  });

  test("a macro outside Oryx's pattern stays native and its case stays in passthrough", async () => {
    const files = await base();
    const keymapC = files.keymapC.replace("SEND_STRING(SS_LGUI(SS_LSFT(SS_TAP(X_4))));", 'SEND_STRING("hello");');
    const r = await importQmkSource({ ...files, keymapC }, board.definition);
    expect(r.layout.macros.map((m) => m.name)).toEqual(["ST_MACRO_1", "ST_MACRO_2", "ST_MACRO_3"]);
    expect(r.layout.layers[0]?.bindings[56]).toMatchObject({ kind: "native", source: "ST_MACRO_0" });
    expect(r.layout.passthrough.some((p) => p.anchor === "process_record_user:ST_MACRO_0" && p.source.includes('"hello"'))).toBe(true);
  });

  test("a combo whose key is on no base-layer position is reported and skipped", async () => {
    const files = await base();
    const keymapC = files.keymapC.replace("{ KC_COMMA, KC_DOT, COMBO_END}", "{ KC_COMMA, KC_PSCR, COMBO_END}");
    const r = await importQmkSource({ ...files, keymapC }, board.definition);
    expect(r.layout.combos).toHaveLength(7);
    expect(r.report.warnings.join("\n")).toContain("combo combo7 not imported");
  });

  test("a combo key present twice on the base layer is placed on the first and reported", async () => {
    const files = await base();
    const keymapC = files.keymapC.replace("{ KC_COMMA, KC_DOT, COMBO_END}", "{ KC_ESC, KC_DOT, COMBO_END}"); // KC_ESC == KC_ESCAPE, at 0 and 14
    const r = await importQmkSource({ ...files, keymapC }, board.definition);
    expect(r.layout.combos[7]?.positions).toEqual([0, 51]);
    expect(r.report.warnings.join("\n")).toContain("positions 0, 14");
  });

  test("non-ASCII text before a passthrough block does not shift its source", async () => {
    const files = await base();
    const keymapC = files.keymapC.replace("enum custom_keycodes", "// mäkro naïve 日本語\nenum custom_keycodes");
    const r = await importQmkSource({ ...files, keymapC }, board.definition);
    expect(r.layout.passthrough.find((p) => p.anchor === "chordal-hold-layout")?.source.startsWith("const char chordal_hold_layout")).toBe(true);
    expect(r.layout.passthrough.find((p) => p.anchor === "tap-dance-codes")?.source.startsWith("enum tap_dance_codes")).toBe(true);
  });

  test("an unreferenced custom #define is not kept", async () => {
    const files = await base();
    const keymapC = files.keymapC.replace("#define DUAL_FUNC_0", "#define UNUSED_THING 1\n#define DUAL_FUNC_0");
    const r = await importQmkSource({ ...files, keymapC }, board.definition);
    expect(r.layout.passthrough.some((p) => p.anchor.includes("UNUSED_THING"))).toBe(false);
  });

  test("config.h with conditionals warns", async () => {
    const files = await base();
    const r = await importQmkSource({ ...files, configH: `${files.configH}\n#ifdef FOO\n#define BAR 1\n#endif\n` }, board.definition);
    expect(r.report.warnings.join("\n")).toContain("#if");
  });

  test("a later #define of the same setting wins", async () => {
    const files = await base();
    const r = await importQmkSource({ ...files, configH: `#define TAPPING_TERM 200\n#define TAPPING_TERM 150\n` }, board.definition);
    expect(r.layout.settings.filter((s) => s.key === "TAPPING_TERM")).toEqual([{ firmware: "qmk", key: "TAPPING_TERM", value: 150 }]);
  });

  test("a ZMK board is refused", async () => {
    const zmk = { ...board.definition, firmware: "zmk" as const };
    await expect(importQmkSource(await base(), zmk)).rejects.toThrow(ImportError);
  });
});
