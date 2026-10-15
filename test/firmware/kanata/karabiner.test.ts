// A synthetic Karabiner file with the same patterns BK's has (and none of its keys or names) becomes the MacBook's starting layout.
// The golden test pins the whole chain: karabiner.json -> layout -> keyloom.kbd -> kanata --check.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateKanataSource } from "../../../src/firmware/kanata/generate.ts";
import { KarabinerImportError, importKarabiner, karabinerKey } from "../../../src/firmware/kanata/karabiner.ts";
import { validate } from "../../../src/validation/validate.ts";
import { kanataBinary, kanataCheck } from "../../helpers/kanata-bin.ts";
import { at, macbook } from "../../helpers/macbook.ts";
import { tempDir } from "../../helpers/tmp.ts";

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures");
const fileText = readFileSync(join(FIXTURES, "karabiner", "synthetic-karabiner.json"), "utf8");

function golden(name: string, actual: string): void {
  const path = join(FIXTURES, "kanata", name);
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(join(FIXTURES, "kanata"), { recursive: true });
    writeFileSync(path, actual);
  }
  expect(existsSync(path)).toBe(true);
  expect(actual).toBe(readFileSync(path, "utf8"));
}

describe("importing a Karabiner file", () => {
  const imported = importKarabiner(fileText, macbook());
  const base = imported.layout.layers[0]!;

  test("the fixture is synthetic: no shell commands, home paths or URLs", () => {
    expect(fileText).not.toMatch(/shell_command|\/Users\/|osascript|https?:/);
  });

  test("Space holds a layer and taps Space; the layer has the arrows on W A S D", () => {
    expect(base.bindings[at("SPACE")]).toMatchObject({ kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "nav-mode" } });
    const nav = imported.layout.layers.find((l) => l.id === "nav-mode")!;
    expect(nav.bindings[at("W")]).toEqual({ kind: "key", code: "UP" });
    expect(nav.bindings[at("A")]).toEqual({ kind: "key", code: "LEFT" });
    expect(nav.bindings[at("S")]).toEqual({ kind: "key", code: "DOWN" });
    expect(nav.bindings[at("D")]).toEqual({ kind: "key", code: "RIGHT" });
    expect(nav.bindings.filter((b) => b.kind !== "transparent")).toHaveLength(4);
  });

  test("home-row mods: A is Shift, D and K are Command, ; is right Shift, at 250 ms", () => {
    const hold = (code: string) => {
      const b = base.bindings[at(code)]!;
      return b.kind === "holdTap" && "mods" in b.hold ? { tap: b.tap.code, mods: b.hold.mods, profile: b.profileId } : undefined;
    };
    expect(hold("A")).toEqual({ tap: "A", mods: ["LSFT"], profile: "home-row-250" });
    expect(hold("D")).toMatchObject({ mods: ["LGUI"] });
    expect(hold("K")).toMatchObject({ mods: ["RGUI"] });
    expect(hold("SEMICOLON")).toMatchObject({ mods: ["RSFT"] });
    const profile = imported.layout.holdTapProfiles.find((p) => p.id === "home-row-250")!;
    expect(profile.options).toMatchObject({ variant: "tap-hold-tap-keys", "hold-ms": 250 });
  });

  test("T and Y hold Hyper", () => {
    expect(base.bindings[at("T")]).toMatchObject({ kind: "holdTap", tap: { code: "T" }, hold: { mods: ["LSFT", "LCTL", "LALT", "LGUI"] } });
  });

  test("the combos keep their keys, outputs and 40 ms threshold", () => {
    expect(imported.layout.combos).toHaveLength(3);
    const nm = imported.layout.combos.find((c) => c.positions.includes(at("N")) && c.positions.includes(at("M")))!;
    expect(nm).toMatchObject({ output: { kind: "key", code: "Z", mods: ["LGUI"] }, timeoutMs: 40, layerIds: "all" });
    const qw = imported.layout.combos.find((c) => c.positions.includes(at("Q")))!;
    expect(qw.output).toEqual({ kind: "key", code: "ESCAPE" });
  });

  test("simple_modifications and fn_function_keys become key remaps", () => {
    expect(base.bindings[at("CAPS_LOCK")]).toEqual({ kind: "key", code: "ESCAPE" });
    expect(base.bindings[at("F5")]).toEqual({ kind: "key", code: "F14" });
  });

  test("the switched-off rule and the one keyloom can't read are listed, not imported, and nothing is lost", () => {
    expect(imported.passthrough.map((p) => p.rule)).toEqual([expect.stringContaining("F15"), "b clicks the mouse"]);
    expect(imported.passthrough[0]!.reason).toContain("switched off");
    expect(imported.report.warnings.join("\n")).toContain("Not imported, left as it is in Karabiner");
    expect(imported.recognised).toHaveLength(6);
    expect(base.bindings[at("B")]).toEqual({ kind: "key", code: "B" });
  });

  test("the disable edit is text to apply, names the built-in keyboard and says Karabiner's list is authoritative", () => {
    expect(imported.disableEdit).toContain('"ignore": true');
    expect(imported.disableEdit).toContain("karabiner_cli --list-connected-devices");
    expect(imported.disableEdit).toContain("Rules keyloom did not import (1)");
    expect(imported.report.instructions).toBe(imported.disableEdit);
  });

  test("the layout passes keyloom's own validator on the MacBook board, with Esc and Control reachable", () => {
    const result = validate(macbook(), imported.layout, []);
    expect(result.errors).toEqual([]);
  });

  test("golden: layout, keyloom.kbd and the edit text", async () => {
    golden("karabiner-imported-layout.json", `${JSON.stringify(imported.layout, null, 2)}\n`);
    const src = generateKanataSource({ layout: imported.layout, board: macbook(), layoutId: "lay_SYN", revisionId: "rev_SYN" });
    golden("karabiner-imported.kbd", src.files[0]!.content);
    golden("karabiner-disable-edit.txt", `${imported.disableEdit}\n`);
    const bin = kanataBinary();
    if (!bin) return; // --check needs the kanata binary (KEYLOOM_KANATA_BIN)
    const r = await kanataCheck(bin, src.files[0]!.content, tempDir(), "synthetic.kbd");
    expect(r.output).toContain("config file is valid");
  });

  test("importing twice gives the same layout (no dependence on object order)", () => {
    expect(importKarabiner(fileText, macbook()).layout).toEqual(imported.layout);
  });
});

describe("what is not recognised is kept as passthrough, whole", () => {
  const rule = (manipulators: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ profiles: [{ selected: true, complex_modifications: { rules: [{ description: "mine", manipulators, ...extra }] } }] });
  test("a shell command rule is listed and nothing from it is imported", () => {
    const r = importKarabiner(rule([{ type: "basic", from: { key_code: "f" }, to: [{ shell_command: "open -a Safari" }] }]), macbook());
    expect(r.passthrough).toHaveLength(1);
    expect(r.layout.layers).toHaveLength(1);
    expect(r.layout.layers[0]!.bindings[at("F")]).toEqual({ kind: "key", code: "F" });
  });

  test("a rule with one unreadable manipulator among readable ones is not half-imported", () => {
    const r = importKarabiner(rule([
      { type: "basic", from: { key_code: "a" }, to: [{ key_code: "b" }] },
      { type: "basic", from: { key_code: "c" }, to: [{ pointing_button: "button1" }] },
    ]), macbook());
    expect(r.passthrough).toHaveLength(1);
    expect(r.layout.layers[0]!.bindings[at("A")]).toEqual({ kind: "key", code: "A" });
  });

  test("a mandatory modifier on the from side is not a plain key and stays in Karabiner", () => {
    const r = importKarabiner(rule([{ type: "basic", from: { key_code: "a", modifiers: { mandatory: ["left_shift"] } }, to: [{ key_code: "b" }] }]), macbook());
    expect(r.passthrough).toHaveLength(1);
  });

  test("not JSON, no profiles and key names", () => {
    expect(() => importKarabiner("{", macbook())).toThrow(KarabinerImportError);
    expect(() => importKarabiner("{}", macbook())).toThrow(/no profiles/);
    expect(karabinerKey("spacebar")).toBe("SPACE");
    expect(karabinerKey("fn")).toBeUndefined();
    expect(karabinerKey("left_command")).toBe("LEFT_GUI");
  });
});

test("importing never writes to the file it reads", async () => {
  const dir = tempDir();
  const path = join(dir, "karabiner.json");
  writeFileSync(path, fileText);
  const { chmodSync, statSync } = await import("node:fs");
  chmodSync(path, 0o444);
  const before = statSync(path).mtimeMs;
  importKarabiner(readFileSync(path, "utf8"), macbook());
  expect(statSync(path).mtimeMs).toBe(before);
});
