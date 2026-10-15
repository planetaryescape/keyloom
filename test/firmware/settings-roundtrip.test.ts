import { describe, expect, test } from "bun:test";
import { parseDefines } from "../../src/firmware/qmk/config-h.ts";
import { generateQmkSource } from "../../src/firmware/qmk/generate.ts";
import { importOryxSource, importQmkSource } from "../../src/firmware/qmk/import.ts";
import { readOryxSource } from "../../src/firmware/qmk/source.ts";
import { generateZmkSource } from "../../src/firmware/zmk/generate.ts";
import { importZmk, importZmkSource } from "../../src/firmware/zmk/import.ts";
import { OPTIONS, currentValue, optionsFor } from "../../src/layout/firmware-options.ts";
import { type Layout } from "../../src/layout/schema.ts";
import { settingsChange } from "../../src/layout/settings-ops.ts";
import { applyOps } from "../../src/layout/apply-ops.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../helpers/zmk.ts";

const ml = await moonlander();
const gl = await glove80();

const qmkSource = async (layout: Layout) => {
  const generated = generateQmkSource({ layout, board: ml.definition, revisionId: "rev_T" });
  const get = (p: string) => generated.files.find((f) => f.path === p)?.content;
  return { generated, files: { ...(await readOryxSource(FIXTURE_DIR)), keymapC: get("keymap.c") as string, configH: get("config.h") as string, rulesMk: get("rules.mk") as string } };
};

describe("untouched settings round-trip through import and generation (Moonlander, BK's Oryx export)", () => {
  test("config.h keeps every define and value Oryx wrote, the derived COMBO_COUNT and the serial number aside", async () => {
    const { layout } = await importOryxSource(FIXTURE_DIR, ml.definition);
    const { generated } = await qmkSource(layout);
    const defines = (text: string) => Object.fromEntries(parseDefines(text).defines.map((d) => [d.name, d.value]));
    const out = defines(generated.files.find((f) => f.path === "config.h")?.content as string);
    const orig = defines(await Bun.file(`${FIXTURE_DIR}/config.h`).text());
    expect(out).toEqual(orig);
  });

  test("rules.mk is Oryx's, byte for byte, when no feature switch was touched", async () => {
    const { layout } = await importOryxSource(FIXTURE_DIR, ml.definition);
    const { generated } = await qmkSource(layout);
    expect(generated.files.find((f) => f.path === "rules.mk")?.content).toBe(await Bun.file(`${FIXTURE_DIR}/rules.mk`).text());
  });

  test("every option on the page reads the same after import, generate and import", async () => {
    const first = (await importOryxSource(FIXTURE_DIR, ml.definition)).layout;
    const { files } = await qmkSource(first);
    const second = (await importQmkSource(files, ml.definition)).layout;
    for (const spec of optionsFor(ml.definition)) {
      expect({ key: spec.key, value: currentValue(spec, second, ml.definition) }).toEqual({ key: spec.key, value: currentValue(spec, first, ml.definition) });
    }
  });

  test("options that are changed read back as changed: Caps Word and Auto Shift in rules.mk, the terms in config.h", async () => {
    const first = (await importOryxSource(FIXTURE_DIR, ml.definition)).layout;
    const spec = (k: string) => OPTIONS.find((o) => o.firmware === "qmk" && o.key === k) as (typeof OPTIONS)[number];
    const change = settingsChange(first, ml.definition, [
      { spec: spec("CAPS_WORD_ENABLE"), value: true }, { spec: spec("CAPS_WORD_IDLE_TIMEOUT"), value: 3000 }, { spec: spec("COMBO_TERM"), value: 40 }, { spec: spec("MOUSEKEY_ENABLE"), value: false },
    ]);
    const edited = (applyOps(first, change?.ops ?? []) as { layout: Layout }).layout;
    const { generated, files } = await qmkSource(edited);
    const h = generated.files.find((f) => f.path === "config.h")?.content as string;
    const rules = generated.files.find((f) => f.path === "rules.mk")?.content as string;
    expect(h).toContain("#define CAPS_WORD_IDLE_TIMEOUT 3000\n");
    expect(h).toContain("#define COMBO_TERM 40\n");
    // A feature switch in config.h would do nothing, so it must not be there.
    expect(h).not.toContain("CAPS_WORD_ENABLE");
    expect(h).not.toContain("MOUSEKEY_ENABLE");
    expect(rules).toContain("CAPS_WORD_ENABLE = yes\n");
    expect(rules).toContain("MOUSEKEY_ENABLE = no\n");
    expect(rules.startsWith(await Bun.file(`${FIXTURE_DIR}/rules.mk`).text())).toBe(true);
    const again = (await importQmkSource(files, ml.definition)).layout;
    for (const key of ["CAPS_WORD_ENABLE", "CAPS_WORD_IDLE_TIMEOUT", "COMBO_TERM", "MOUSEKEY_ENABLE"]) {
      expect({ key, now: currentValue(spec(key), again, ml.definition) }).toEqual({ key, now: currentValue(spec(key), edited, ml.definition) });
    }
  });

  test("a tapping term changed on the page reaches the hold-tap keys: no per-key callback undoes it", async () => {
    const first = (await importOryxSource(FIXTURE_DIR, ml.definition)).layout;
    const spec = OPTIONS.find((o) => o.firmware === "qmk" && o.key === "TAPPING_TERM") as (typeof OPTIONS)[number];
    const change = settingsChange(first, ml.definition, [{ spec, value: 180 }]);
    const edited = (applyOps(first, change?.ops ?? []) as { layout: Layout }).layout;
    const { generated } = await qmkSource(edited);
    expect(generated.files.find((f) => f.path === "config.h")?.content).toContain("#define TAPPING_TERM 180\n");
    expect(generated.files.find((f) => f.path === "keymap.c")?.content).not.toContain("get_tapping_term");
  });
});

describe("untouched settings round-trip on the Glove80 (ZMK)", () => {
  const confOf = (layout: Layout) => generateZmkSource({ layout, board: gl.definition, geometry: gl.geometry, revisionId: "rev_T" }).files.find((f) => f.path.endsWith(".conf"))?.content ?? "";

  test("the template's conf, with nothing in it, stays with nothing in it", async () => {
    const { layout } = await importZmkSource(TEMPLATE_FIXTURE, gl.definition);
    expect(layout.settings).toEqual([]);
    expect(confOf(layout).split("\n").filter((l) => l.trim() !== "" && !l.startsWith("//") && !l.startsWith("#"))).toEqual([]);
  });

  test("a conf that sets the page's options reads, shows and writes back the same values", async () => {
    const conf = "CONFIG_ZMK_IDLE_TIMEOUT=60000\nCONFIG_ZMK_SLEEP=y\nCONFIG_ZMK_IDLE_SLEEP_TIMEOUT=600000\nCONFIG_ZMK_COMBO_MAX_PRESSED_COMBOS=6\nCONFIG_ZMK_POINTING=y\nCONFIG_ZMK_BLE_PASSKEY_ENTRY=n\nCONFIG_ZMK_RGB_UNDERGLOW_BRT_MAX=60\n";
    const keymap = await Bun.file(`${TEMPLATE_FIXTURE}/glove80.keymap`).text();
    const first = (await importZmk({ name: "x", keymap, conf }, gl.definition)).layout;
    const out = confOf(first);
    for (const line of conf.trim().split("\n")) expect(out).toContain(line);
    const second = (await importZmk({ name: "x", keymap, conf: out }, gl.definition)).layout;
    for (const spec of optionsFor(gl.definition)) {
      expect({ key: spec.key, value: currentValue(spec, second, gl.definition) }).toEqual({ key: spec.key, value: currentValue(spec, first, gl.definition) });
    }
    expect(currentValue(OPTIONS.find((o) => o.key === "CONFIG_ZMK_IDLE_TIMEOUT") as (typeof OPTIONS)[number], first, gl.definition)).toBe(60000);
  });

  test("Kconfig options the page has no control for are listed read only, not dropped", async () => {
    const { otherSettings } = await import("../../src/layout/firmware-options.ts");
    const keymap = await Bun.file(`${TEMPLATE_FIXTURE}/glove80.keymap`).text();
    const l = (await importZmk({ name: "x", keymap, conf: "CONFIG_ZMK_RGB_UNDERGLOW_BRT_MAX=60\n" }, gl.definition)).layout;
    expect(otherSettings(l, gl.definition).map((s) => s.key)).toEqual(["CONFIG_ZMK_RGB_UNDERGLOW_BRT_MAX"]);
  });
});
