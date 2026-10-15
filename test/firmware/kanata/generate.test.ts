import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GenerateError, KBD_FILE, SAFE_FILE, generateKanataSource } from "../../../src/firmware/kanata/generate.ts";
import { identityLayout } from "../../../src/firmware/kanata/identity.ts";
import { readHeader } from "../../../src/firmware/kanata/header.ts";
import { KANATA_VARIANTS } from "../../../src/layout/kanata/profiles.ts";
import { kanataBinary, kanataCheck } from "../../helpers/kanata-bin.ts";
import { macbook, richLayout, at } from "../../helpers/macbook.ts";
import { tempDir } from "../../helpers/tmp.ts";

const GOLDEN = join(import.meta.dir, "..", "..", "fixtures", "kanata");
const gen = (layout = richLayout()) => generateKanataSource({ layout, board: macbook(), layoutId: "lay_TEST", revisionId: "rev_TEST" });
const file = (src: ReturnType<typeof gen>, name: string) => src.files.find((f) => f.path === name)!.content;

// Golden files are the reviewed output. Regenerate with UPDATE_GOLDEN=1 and read the diff.
function golden(name: string, actual: string): void {
  const path = join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(path, actual);
  }
  expect(existsSync(path)).toBe(true);
  expect(actual).toBe(readFileSync(path, "utf8"));
}

describe("keyloom.kbd for the MacBook", () => {
  test("identity layout: golden", () => {
    const src = generateKanataSource({ layout: identityLayout(macbook()), board: macbook(), layoutId: "lay_TEST", revisionId: "rev_TEST" });
    golden("identity.kbd", file(src, KBD_FILE));
    golden("safe.kbd", file(src, SAFE_FILE));
  });

  test("rich layout: golden", () => {
    golden("rich.kbd", file(gen(), KBD_FILE));
  });

  test("the header names the layout and revision and the hash covers the body", () => {
    const text = file(gen(), KBD_FILE);
    const h = readHeader(text)!;
    expect(h).toMatchObject({ layoutId: "lay_TEST", revisionId: "rev_TEST", intact: true });
    expect(readHeader(text.replace("(defcfg", "(defcfg ;; hand edit"))!.intact).toBe(false);
    expect(readHeader("(defsrc a)")).toBeUndefined();
  });

  test("the revision marker is a virtual key and the layer names are listed", () => {
    const src = gen();
    expect(src.marker).toBe("keyloom-rev_TEST");
    expect(file(src, KBD_FILE)).toContain("keyloom-rev_TEST XX");
    expect(src.layerNames).toEqual(["base", "nav", "num"]);
  });

  test("combos use defchordsv2 with concurrent-tap-hold, and are disabled on the layers they are not on", () => {
    const text = file(gen(), KBD_FILE);
    expect(text).toContain("concurrent-tap-hold yes");
    expect(text).toMatch(/\(x c\) M-x 50 first-release \(\)/);
    expect(text).toMatch(/\(i o\) eql 50 first-release \(nav num\)/);
    expect(file(gen(identityLayout(macbook())), KBD_FILE)).not.toContain("concurrent-tap-hold");
  });

  test("never writes cmd or danger-enable-cmd", () => {
    const all = gen().files.map((f) => f.content).join("\n");
    expect(all).not.toMatch(/\bcmd\b|danger-enable-cmd/);
  });

  test("macros: text gets Shift, number keys keep their names, held modifiers wrap what is tapped", () => {
    const text = file(gen(), KBD_FILE);
    expect(text).toContain("(macro S-b e s t comm spc S-b S-k S-Digit1 100 M-s)".replace("S-b S-k S-Digit1", "S-b S-k S-Digit1"));
  });

  test("Option-Option is two taps of Option", () => {
    expect(file(gen(), KBD_FILE)).toContain("(macro lalt lalt)");
  });

  test("a toggle returns from the layer it turned on", () => {
    const text = file(gen(), KBD_FILE);
    expect(text).toContain("(layer-switch num)");
    expect(text).toContain("(layer-switch base)");
  });

  test("each hold-tap variant is written as its kanata form", () => {
    for (const variant of KANATA_VARIANTS) {
      const text = file(gen(richLayout(variant)), KBD_FILE);
      expect(text).toContain(`(${variant} `);
      if (variant === "tap-hold-tap-keys") expect(text).toContain("(defvar");
      if (variant.startsWith("tap-hold-opposite-hand")) expect(text).toContain("(defhands");
    }
  });

  test("what kanata can't do is refused, not dropped", () => {
    const base = richLayout();
    const withHold = { ...base, tapDances: [{ id: "td-tab", name: "Tab", tap: { kind: "key" as const, code: "TAB" as const }, hold: { kind: "key" as const, code: "ESCAPE" as const } }] };
    expect(() => gen(withHold)).toThrow(/hold or tap-then-hold slot/);
    const foreign = { ...base, layers: base.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (p === at("Q") ? { kind: "native" as const, firmware: "qmk" as const, source: "KC_MY_THING", label: "x" } : b)) } : l)) };
    expect(() => gen(foreign)).toThrow(GenerateError);
    const cmd = { ...base, layers: base.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (p === at("Q") ? { kind: "native" as const, firmware: "kanata" as const, source: '(cmd rm -rf /)', label: "x" } : b)) } : l)) };
    expect(() => gen(cmd)).toThrow(/runs a command as root/);
  });

  test("QMK and ZMK caps word and sticky mods are translated", () => {
    const base = richLayout();
    const make = (firmware: "qmk" | "zmk", source: string) => ({ ...base, layers: base.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (p === at("Q") ? { kind: "native" as const, firmware, source, label: "x" } : b)) } : l)) });
    expect(file(gen(make("qmk", "CW_TOGG")), KBD_FILE)).toContain("(caps-word-toggle 2000)");
    expect(file(gen(make("zmk", "&sk LSHIFT")), KBD_FILE)).toContain("(one-shot 2000 lshift)");
  });
});

describe("kanata --check", () => {
  const bin = kanataBinary();
  const dir = tempDir();
  const fixtures: Array<[string, () => ReturnType<typeof gen>]> = [
    ["identity", () => generateKanataSource({ layout: identityLayout(macbook()), board: macbook(), layoutId: "lay_T", revisionId: "rev_T" })],
    ...KANATA_VARIANTS.map((v): [string, () => ReturnType<typeof gen>] => [`rich-${v}`, () => gen(richLayout(v))]),
  ];
  for (const [name, make] of fixtures) {
    test.skipIf(!bin)(`${name}: keyloom.kbd and safe.kbd pass`, async () => {
      for (const f of make().files) {
        const r = await kanataCheck(bin!, f.content, dir, `${name}-${f.path}`);
        expect(r.output).toContain("config file is valid");
        expect(r.ok).toBe(true);
      }
    });
  }
});
