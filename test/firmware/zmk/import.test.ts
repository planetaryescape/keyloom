import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { importZmk, importZmkSource, ZmkImportError } from "../../../src/firmware/zmk/import.ts";
import { STYLE_FIXTURE, TEMPLATE_FIXTURE, glove80 } from "../../helpers/zmk.ts";
import { tempDir } from "../../helpers/tmp.ts";

const board = (await glove80()).definition;
const template = await importZmkSource(TEMPLATE_FIXTURE, board);
const style = await importZmkSource(STYLE_FIXTURE, board);

/** A keymap with one layer of 80 `&none` and `extra` inside the root node. */
const small = (opts: { bindings?: string; extra?: string; head?: string; layers?: string } = {}): string =>
  `${opts.head ?? ""}\n/ {\n  ${opts.extra ?? ""}\n  keymap {\n    compatible = "zmk,keymap";\n    base { bindings = <${opts.bindings ?? Array(80).fill("&none").join(" ")}>; };\n    ${opts.layers ?? ""}\n  };\n};\n`;

describe("the template's default keymap (MoErgo glove80-zmk-config 34888be)", () => {
  test("has four layers of 80 bindings, named from their nodes", () => {
    expect(template.layout.layers.map((l) => [l.id, l.name, l.bindings.length])).toEqual([
      ["default-layer", "default_layer", 80],
      ["lower-layer", "lower_layer", 80],
      ["magic-layer", "magic_layer", 80],
      ["factory-test-layer", "factory_test_layer", 80],
    ]);
    expect(template.suggestedName).toBe("glove80");
  });

  test("reads keys, modifiers and layer moves, and keeps what it doesn't model as native with the source as written", () => {
    const base = template.layout.layers[0]?.bindings ?? [];
    expect(base[0]).toEqual({ kind: "key", code: "F1" });
    expect(base[10]).toEqual({ kind: "key", code: "EQUAL" });
    expect(base[52]).toEqual({ kind: "modifier", mods: ["LSFT"] });
    // &layer_td is the template's own tap dance, and &magic MAGIC 0 its own hold-tap over a macro.
    expect(base[54]).toEqual({ kind: "native", firmware: "zmk", source: "&layer_td", label: "layer_td" });
    expect(base[64]).toMatchObject({ kind: "native", source: "&magic MAGIC 0" });
    const lower = template.layout.layers[1]?.bindings ?? [];
    expect(lower[54]).toEqual({ kind: "layer", action: "to", layerId: "default-layer" });
    expect(lower[10]).toEqual({ kind: "transparent" });
    expect(lower[8]).toEqual({ kind: "none" });
    const magic = template.layout.layers[2]?.bindings ?? [];
    expect(magic[0]).toMatchObject({ kind: "native", source: "&bt BT_CLR" });
    expect(magic[71]).toMatchObject({ kind: "native", source: "&out OUT_USB" });
    expect(magic[79]).toEqual({ kind: "layer", action: "to", layerId: "factory-test-layer" });
  });

  test("keeps defines, tap dance, the magic hold-tap and the macros that use unmodelled behaviours verbatim", () => {
    expect(template.layout.passthrough.map((p) => p.anchor)).toEqual([
      "define:HYPER", "define:DEFAULT", "define:LOWER", "define:MAGIC", "define:FACTORY_TEST",
      "behavior:layer_td", "behavior:magic",
      "macro:rgb_ug_status_macro", "macro:bt_0", "macro:bt_1", "macro:bt_2", "macro:bt_3",
    ]);
    const td = template.layout.passthrough.find((p) => p.anchor === "behavior:layer_td");
    expect(td?.source.startsWith("layer_td: tap_dance_0 {\n    compatible = \"zmk,behavior-tap-dance\";")).toBe(true);
    expect(td?.source.endsWith("};")).toBe(true);
    // The index defines pin layer order, the way QMK's layer numbers do.
    expect(template.layout.passthrough.find((p) => p.anchor === "define:LOWER")?.refersToLayerIndices).toBe(true);
    expect(template.layout.passthrough.find((p) => p.anchor === "define:HYPER")?.refersToLayerIndices).toBe(false);
  });

  test("the report counts bindings and lists every native binding and kept block with the reason", () => {
    const r = template.report;
    expect(r.layers).toBe(4);
    expect(r.keysPerLayer).toBe(80);
    expect(Object.values(r.bindings).reduce((a, b) => a + b, 0)).toBe(320);
    expect(r.bindings.native).toBe(r.native.length);
    expect(r.native.find((n) => n.source === "&bootloader")).toMatchObject({ layerId: "magic-layer", position: 34, reason: "&bootloader isn't modelled" });
    expect(r.passthrough).toHaveLength(12);
    expect(r.warnings.some((w) => w.includes("macro bt_0 kept as written"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("no .conf"))).toBe(false);
  });
});

test("kept custom layer and sticky behaviours on native keys are renumbered", async () => {
  const source = small({
    extra: `behaviors {
      my_mo: my_mo { compatible = "zmk,behavior-momentary-layer"; #binding-cells = <1>; };
      my_sticky: my_sticky { compatible = "zmk,behavior-sticky-key"; bindings = <&my_mo>; };
    };`,
    bindings: `&my_mo 2 &my_sticky 1 ${Array(78).fill("&none").join(" ")}`,
    layers: `lower { bindings = <${Array(80).fill("&none").join(" ")}>; };
      upper { bindings = <${Array(80).fill("&none").join(" ")}>; };`,
  });
  const imported = await importZmk({ name: "custom-layer-behaviours", keymap: source }, board);
  expect(imported.layout.layers[0]?.bindings[0]).toMatchObject({ kind: "native", layerRefs: [{ layerId: "upper" }] });
  expect(imported.layout.layers[0]?.bindings[1]).toMatchObject({ kind: "native", layerRefs: [{ layerId: "lower" }] });
});

describe("a Layout Editor style keymap", () => {
  const l = style.layout;

  test("hold-taps become profiles with ZMK's own option names, and uses become holdTap bindings", () => {
    const hm = l.holdTapProfiles.find((p) => p.id === "hm");
    expect(hm).toEqual({
      id: "hm", name: "HOMEROW_MODS", firmware: "zmk",
      options: {
        bindings: "&kp &kp", flavor: "balanced", "tapping-term-ms": 280, "quick-tap-ms": 175, "require-prior-idle-ms": 150,
        "hold-trigger-key-positions": [5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21, 28, 29, 30, 31, 32, 33, 40, 41, 42, 43, 44, 45],
        "hold-trigger-on-release": true,
      },
    });
    const base = l.layers[0]?.bindings ?? [];
    expect(base[35]).toEqual({ kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LGUI"] }, profileId: "hm" });
    expect(base[38]).toEqual({ kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LSFT"] }, profileId: "hm" });
  });

  test("a hold-tap whose hold is &mo takes a layer, and the built-in &lt and &mt are profiles with ZMK's defaults", () => {
    const lt = l.holdTapProfiles.find((p) => p.id === "lt_sp");
    expect(lt?.options.bindings).toBe("&mo &kp");
    const base = l.layers[0]?.bindings ?? [];
    expect(base[54]).toEqual({ kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "layer-nav" }, profileId: "lt" });
    expect(base[64]).toEqual({ kind: "holdTap", tap: { code: "ESCAPE" }, hold: { mods: ["LCTL"] }, profileId: "mt" });
    expect(l.holdTapProfiles.find((p) => p.id === "lt")?.options).toEqual({ bindings: "&mo &kp", flavor: "tap-preferred", "tapping-term-ms": 200 });
  });

  test("an override of a built-in (&mt { ... }) becomes that profile's options; one of something unmodelled is kept", () => {
    expect(l.holdTapProfiles.find((p) => p.id === "mt")?.options).toEqual({ bindings: "&kp &kp", flavor: "hold-preferred", "tapping-term-ms": 175 });
    expect(l.passthrough.find((p) => p.anchor === "top:sk")?.source).toBe("&sk {\n    release-after-ms = <900>;\n};");
  });

  test("macros step through press, tap and release modes, and a wait time applies to the bindings after it", () => {
    expect(l.macros.find((m) => m.id === "paste_twice")).toEqual({
      id: "paste_twice", name: "PASTE_TWICE",
      steps: [
        { op: "press", mods: ["LSFT"] },
        { op: "tap", code: "V", mods: ["LGUI"] },
        // `&macro_wait_time 40` is a setting, so it is the delay after every binding that follows it.
        { op: "release", mods: ["LSFT"] },
        { op: "waitMs", ms: 40 },
        { op: "tap", code: "V", mods: ["LGUI"] },
        { op: "waitMs", ms: 40 },
      ],
    });
    expect(l.layers[0]?.bindings[71]).toEqual({ kind: "macro", macroId: "opt_opt" });
  });

  test("a macro with timing properties it has no field for is kept as written, and its uses are native", () => {
    expect(l.macros.map((m) => m.id)).toEqual(["opt_opt", "paste_twice"]);
    expect(l.passthrough.some((p) => p.anchor === "macro:timed")).toBe(true);
    expect(style.report.warnings).toContain("macro timed kept as written: it sets wait-ms, which keyloom doesn't model");
  });

  test("combos get positions, layers (all, written as <(-1)> or left out, or a list), timeouts and outputs", () => {
    expect(l.combos).toEqual([
      { id: "combo-esc", name: "combo_esc", positions: [12, 13], layerIds: "all", output: { kind: "key", code: "ESCAPE" }, timeoutMs: 40 },
      { id: "combo-caps", name: "combo_caps", positions: [35, 36, 37], layerIds: ["layer-base", "layer-nav"], output: { kind: "native", firmware: "zmk", source: "&caps_word", label: "CapsW" } },
    ]);
    expect(l.passthrough.some((p) => p.anchor === "combo:combo_slow")).toBe(true);
  });

  test("a combo with no layers is on every layer, because the firmware treats an empty layer mask that way", async () => {
    const r = await importZmk({ name: "x", keymap: small({ extra: "combos { compatible = \"zmk,combos\"; c { key-positions = <0 1>; bindings = <&kp A>; }; };" }) }, board);
    expect(r.layout.combos[0]?.layerIds).toBe("all");
  });

  test("layer names come from display-name, else the node; layer references through defines resolve", () => {
    expect(l.layers.map((x) => [x.id, x.name])).toEqual([["layer-base", "Base"], ["layer-nav", "layer_Nav"], ["layer-magic", "layer_Magic"]]);
    expect(l.layers[1]?.bindings[11]).toEqual({ kind: "layer", action: "oneShot", layerId: "layer-base" });
    expect(l.layers[1]?.bindings[12]).toEqual({ kind: "layer", action: "toggle", layerId: "layer-magic" });
  });

  test("shifted symbols and wrapped keys read as a key with modifiers; a define of modifiers is a modifier", () => {
    const base = l.layers[0]?.bindings ?? [];
    expect(base[74]).toEqual({ kind: "key", code: "N4", mods: ["LCTL", "LSFT"] });
    expect(base[79]).toEqual({ kind: "modifier", mods: ["LCTL", "LSFT", "LALT", "LGUI"] });
  });

  test("the .conf next to the .keymap becomes settings, y and n as booleans and numbers as numbers", () => {
    expect(l.settings).toEqual([
      { firmware: "zmk", key: "CONFIG_ZMK_SLEEP", value: true },
      { firmware: "zmk", key: "CONFIG_ZMK_IDLE_SLEEP_TIMEOUT", value: 900000 },
      { firmware: "zmk", key: "CONFIG_BT_CTLR_TX_PWR_PLUS_8", value: true },
      { firmware: "zmk", key: "CONFIG_ZMK_PM_SOFT_OFF", value: false },
      { firmware: "zmk", key: "CONFIG_ZMK_KEYBOARD_NAME", value: '"Glove80 Test"' },
    ]);
  });

  test("includes the Layout Editor always writes are implicit; any other is kept", () => {
    expect(l.passthrough.filter((p) => p.anchor.startsWith("include:")).map((p) => p.source)).toEqual(["#include <dt-bindings/zmk/pointing.h>"]);
  });
});

describe("what it refuses", () => {
  test("a layer with the wrong number of bindings names the layer and the counts", async () => {
    await expect(importZmk({ name: "x", keymap: small({ bindings: "&kp A &kp B" }) }, board)).rejects.toThrow("layer base has 2 bindings, but moergo/glove80 has 80");
  });

  test("no keymap node, a syntax error and a non-devicetree file are errors a person can act on", async () => {
    await expect(importZmk({ name: "x", keymap: "/ { };" }, board)).rejects.toThrow(/no keymap node/);
    await expect(importZmk({ name: "x", keymap: small({ extra: "oops {" }) }, board)).rejects.toThrow(/isn't a devicetree file keyloom can read \(line \d+/);
    await expect(importZmk({ name: "x", keymap: "int main(void) { return 0; }" }, board)).rejects.toThrow(ZmkImportError);
  });

  test("a QMK board is refused", async () => {
    const { moonlander } = await import("../../helpers/board.ts");
    await expect(importZmk({ name: "x", keymap: small() }, (await moonlander()).definition)).rejects.toThrow("is qmk, not zmk");
  });

  test("a file that isn't a .keymap, a missing path and a folder with two keymaps say so", async () => {
    const dir = tempDir();
    await Bun.write(join(dir, "a.txt"), "x");
    await expect(importZmkSource(join(dir, "a.txt"), board)).rejects.toThrow(/not a \.keymap file/);
    await expect(importZmkSource(join(dir, "nope.keymap"), board)).rejects.toThrow(/does not exist/);
    await Bun.write(join(dir, "a.keymap"), small());
    await Bun.write(join(dir, "b.keymap"), small());
    await expect(importZmkSource(dir, board)).rejects.toThrow(/more than one \.keymap/);
    await expect(importZmkSource(join(dir, "a.keymap"), board)).resolves.toMatchObject({ suggestedName: "a" });
  });
});

describe("tolerance", () => {
  test("windows line endings, comments inside bindings and function-like defines don't stop an import", async () => {
    const cells = `${Array(40).fill("&kp A").join(" ")} // a comment between rows\n /* another */ ${Array(40).fill("&kp B").join(" ")}`;
    const keymap = small({ bindings: cells, head: "#define SWAP(a, b) \\\n  b a\n#define NEXT &kp LC(A)" }).replace(/\n/g, "\r\n");
    const r = await importZmk({ name: "x", keymap }, board);
    expect(r.layout.layers[0]?.bindings.slice(38, 42)).toEqual([{ kind: "key", code: "A" }, { kind: "key", code: "A" }, { kind: "key", code: "B" }, { kind: "key", code: "B" }]);
    expect(r.layout.passthrough.map((p) => p.anchor)).toEqual(["define:SWAP", "define:NEXT"]);
  });

  test("a hold-tap with a property keyloom can't read as a plain value is kept whole, and its uses are native", async () => {
    const extra = 'behaviors { weird: weird { compatible = "zmk,behavior-hold-tap"; #binding-cells = <2>; flavor = "balanced"; hold-trigger-key-positions = <&some_phandle>; bindings = <&kp>, <&kp>; }; };';
    const r = await importZmk({ name: "x", keymap: small({ extra, bindings: `&weird LGUI A ${Array(79).fill("&none").join(" ")}` }) }, board);
    expect(r.layout.holdTapProfiles).toEqual([]);
    expect(r.layout.layers[0]?.bindings[0]).toMatchObject({ kind: "native", source: "&weird LGUI A" });
    expect(r.layout.passthrough[0]?.anchor).toBe("behavior:weird");
  });

  test("a binding to a layer or key that doesn't exist is native, not a crash", async () => {
    const r = await importZmk({ name: "x", keymap: small({ bindings: `&mo 9 &kp NOT_A_KEY &lt 9 A ${Array(77).fill("&none").join(" ")}` }) }, board);
    expect(r.layout.layers[0]?.bindings.slice(0, 3).map((b) => b.kind)).toEqual(["native", "native", "native"]);
  });

  test("a property a layer has beyond bindings is reported as dropped", async () => {
    const r = await importZmk({ name: "x", keymap: small().replace("base { bindings", "base { sensor-bindings = <&inc_dec_kp C_VOL_UP C_VOL_DN>; bindings") }, board);
    expect(r.report.warnings).toContain("layer base: sensor-bindings isn't imported and will be dropped");
  });
});

describe("key-caps for behaviours kept as written", () => {
  test("a kept hold-tap reads as its tap and hold, a kept sticky key as one-shot mods, and a macro-tap hold-tap by name", async () => {
    // The shapes in BK's own Glove80 config (bhekanik/glove80-zmk-config 93b6ac8).
    const extra = `behaviors {
      loh: layer_on_hold { compatible = "zmk,behavior-hold-tap"; #binding-cells = <2>; tapping-term-ms = <200>; bindings = <&sl>, <&kp>; };
      skq: sticky_key_quick_release { compatible = "zmk,behavior-sticky-key"; #binding-cells = <1>; bindings = <&sk>; quick-release; };
      magic: magic_hold_tap { compatible = "zmk,behavior-hold-tap"; #binding-cells = <2>; tapping-term-ms = <200>; bindings = <&mo>, <&none>; };
    };`;
    const bindings = ["&loh 2 ENTER", "&loh 1 LA(SPACE)", "&skq LEFT_SHIFT", "&skq RIGHT_SHIFT", "&magic 3 0", ...Array(75).fill("&none")].join(" ");
    const { layout } = await importZmk({ name: "x", keymap: small({ extra, bindings }) }, board);
    const labels = (layout.layers[0]?.bindings ?? []).slice(0, 5).map((b) => (b.kind === "native" ? b.label : b.kind));
    expect(labels).toEqual(["Enter/OSL2", "⌥SPC/OSL1", "OS⇧", "OSr⇧", "magic/L3"]);
  });
});

describe("tap dance import", () => {
  test("imports a tap dance with tap and double-tap keys and tapping-term-ms", async () => {
    const extra = `behaviors {
      td_esc: td_esc_caps {
        compatible = "zmk,behavior-tap-dance";
        display-name = "Escape or Caps";
        #binding-cells = <0>;
        tapping-term-ms = <180>;
        bindings = <&kp ESC>, <&kp CAPS>;
      };
    };`;
    const bindings = ["&td_esc", ...Array(79).fill("&none")].join(" ");
    const { layout, report } = await importZmk({ name: "x", keymap: small({ extra, bindings }) }, board);
    expect(layout.tapDances).toHaveLength(1);
    expect(layout.tapDances[0]).toEqual({
      id: "td_esc",
      name: "Escape or Caps",
      tap: { kind: "key", code: "ESCAPE" },
      doubleTap: { kind: "key", code: "CAPS_LOCK" },
      termMs: 180,
    });
    expect(layout.layers[0]?.bindings[0]).toEqual({ kind: "tapDance", tapDanceId: "td_esc" });
    expect(report.tapDances).toEqual(["Escape or Caps"]);
    expect(layout.passthrough.filter((p) => p.anchor.startsWith("behavior:td_esc"))).toHaveLength(0);
  });

  test("a tap dance with unmodelled bindings is kept as written in passthrough", async () => {
    const extra = `behaviors {
      td_odd: td_odd_node {
        compatible = "zmk,behavior-tap-dance";
        #binding-cells = <0>;
        bindings = <&bt BT_CLR>;
      };
    };`;
    const bindings = ["&td_odd", ...Array(79).fill("&none")].join(" ");
    const { layout } = await importZmk({ name: "x", keymap: small({ extra, bindings }) }, board);
    expect(layout.tapDances).toHaveLength(0);
    expect(layout.layers[0]?.bindings[0]).toMatchObject({ kind: "native", source: "&td_odd" });
    expect(layout.passthrough[0]?.anchor).toBe("behavior:td_odd");
  });
});
