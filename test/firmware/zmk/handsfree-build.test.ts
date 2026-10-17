// What a build adds for hands-free flashing (D-095): the recipe, the serial-number conf, the module beside the checkout, and the
// flags and Nix expression that put it into the firmware. Docker is a fake; the real builds are in the rung's evidence.
import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { HandsFreeSchema } from "../../../src/boards/recipes.ts";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { zmkRevision } from "../../../src/firmware/zmk/board-config.ts";
import { buildZmkWest, moduleFlags, westScript } from "../../../src/firmware/zmk/build-west.ts";
import { buildZmk } from "../../../src/firmware/zmk/build.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { GLOVE80_NIX, RELAY_BAUD, LOCAL_BAUD, halfConfFile, handsFreeConf, keyInArtifact, moduleReport } from "../../../src/firmware/zmk/handsfree.ts";
import { MODULE_DIR, MODULE_FILES, OVERLAY_FILE, writeModule } from "../../../src/firmware/zmk/module.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import { fakeBinDir, fakeSha256Probe, withPath } from "../../helpers/fake-bin.ts";
import { OLD_KEY, glove80Image, serialOf, uf2Carrying } from "../../helpers/fake-zmk-halves.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { TEMPLATE_FIXTURE, boardWithTemplate, combinedUf2, templateRepo, uf2Image } from "../../helpers/zmk.ts";

const ROOT = `${import.meta.dir}/../../..`;
const MODULE_ON_DISK = `${ROOT}/firmware/zmk/keyloom-zmk`;
const BUILD = "bld_01M509Z0DJYBG04NY1MKBCK6TY";
const KEY = "4NY1MKBCK6TY";
const GLOVE80 = await loadBoardDir(`${ROOT}/boards/moergo/glove80`);
const CORNE = await loadBoardDir(`${ROOT}/boards/foostan/corne`);
const handsFreeOf = (b: typeof GLOVE80) => zmkRevision(b.definition).flash.handsFree as NonNullable<ReturnType<typeof zmkRevision>["flash"]["handsFree"]>;

describe("the handsFree recipe", () => {
  const good = () => structuredClone(handsFreeOf(CORNE)) as Record<string, any>;
  const steps = zmkRevision(CORNE.definition).flash.steps;
  const parse = (h: Record<string, unknown>) => HandsFreeSchema.safeParse(h);

  test("both shipped boards have one, and it names flash steps they have", () => {
    for (const b of [GLOVE80, CORNE]) {
      const h = handsFreeOf(b);
      expect(h.trigger).toBe("cdc-1200");
      for (const half of h.halves) expect(zmkRevision(b.definition).flash.steps.map((s) => s.label)).toContain(half.step);
    }
    expect(steps.map((s) => s.label)).toEqual(["left half", "right half"]);
  });

  test("two centrals, a repeated marker, a relayed central and a tail that doesn't end in the chip ID are all rejected", () => {
    expect(parse(good()).success).toBe(true);
    const twoCentrals = good();
    twoCentrals.halves[1].role = "central";
    expect(parse(twoCentrals).success).toBe(false);
    const sameMarker = good();
    sameMarker.halves[1].marker = "L";
    expect(parse(sameMarker).success).toBe(false);
    const relayedCentral = good();
    relayedCentral.halves[0].relay = true;
    expect(parse(relayedCentral).success).toBe(false);
    for (const serialTail of ["0123456789ABCDEF", ":short", ":0123456789abcdef"]) expect(parse({ ...good(), serialTail }).success).toBe(false);
    expect(parse({ ...good(), trigger: "cdc-9600" }).success).toBe(false);
    expect(parse({ ...good(), extra: 1 }).success).toBe(false);
  });

  test("a half naming a step the board doesn't have is a board error, not a flash that silently skips it", async () => {
    const { Uf2DrivesFlashSchema } = await import("../../../src/boards/recipes.ts");
    const flash = structuredClone(zmkRevision(CORNE.definition).flash) as Record<string, any>;
    flash.handsFree.halves[0].step = "middle half";
    expect(Uf2DrivesFlashSchema.safeParse(flash).success).toBe(false);
  });
});

describe("the conf that puts the build's marker in the halves' serial numbers", () => {
  test("a board with its own serial function gets one template per half and the module's override stays off", () => {
    const conf = handsFreeConf(handsFreeOf(GLOVE80), BUILD);
    expect(conf.shared).toEqual([]);
    expect(conf.perHalf.map((f) => f.path)).toEqual(["keyloom-L.conf", "keyloom-R.conf"]);
    expect(conf.perHalf[0]?.content).toContain(`CONFIG_USB_DEVICE_SN="keyloom/${KEY}-L:GLV80-0123456789ABCDEF"`);
    expect(conf.perHalf[1]?.content).toContain(`CONFIG_USB_DEVICE_SN="keyloom/${KEY}-R:GLV80-0123456789ABCDEF"`);
  });

  test("a board with none turns the override on, with one template: the firmware picks the letter from the half's role", () => {
    const conf = handsFreeConf(handsFreeOf(CORNE), BUILD);
    expect(conf.shared).toEqual(["CONFIG_KEYLOOM_SERIAL_OVERRIDE=y", `CONFIG_USB_DEVICE_SN="keyloom/${KEY}-L:0123456789ABCDEF"`]);
    expect(conf.perHalf).toEqual([]);
  });

  test("a template is the length the firmware expects: marker, letter, tail ending in the 16 chip ID characters", () => {
    for (const b of [GLOVE80, CORNE]) {
      const line = handsFreeConf(handsFreeOf(b), BUILD);
      const template = /"(.+)"/.exec((line.shared[1] ?? line.perHalf[0]?.content.split("\n")[1]) as string)?.[1] as string;
      expect(template.startsWith(`keyloom/${KEY}-`)).toBe(true);
      expect(template.slice(-16)).toMatch(/^[0-9A-F]{16}$/);
      // serial.c writes the half letter at this offset.
      expect(template[21]).toMatch(/[LR]/);
      expect(template[20]).toBe("-");
    }
  });

  test("generated source carries the conf for a build and nothing for a plain generate", async () => {
    const imported = await importZmkSource(TEMPLATE_FIXTURE, GLOVE80.definition);
    const input = { layout: imported.layout, board: GLOVE80.definition, geometry: GLOVE80.geometry, revisionId: "rev_x" };
    const plain = generateZmkSource(input);
    expect(plain.files.map((f) => f.path)).toEqual(["glove80.keymap", "glove80.conf"]);
    const built = generateZmkSource({ ...input, handsFree: { buildId: BUILD, config: handsFreeOf(GLOVE80) } });
    expect(built.files.map((f) => f.path)).toEqual(["glove80.keymap", "glove80.conf", "keyloom-L.conf", "keyloom-R.conf"]);
    // The layout's own conf, which both halves read, is unchanged.
    expect(built.files[1]?.content).toBe(plain.files[1]?.content as string);
    expect(generateZmkSource({ ...input, handsFree: { buildId: BUILD, config: handsFreeOf(GLOVE80) } })).toEqual(built);
  });

  test("a build ID that is not keyloom's can't be turned into a marker", () => {
    expect(() => handsFreeConf(handsFreeOf(CORNE), "bld_nope")).toThrow("isn't a build ID");
  });
});

describe("the module that ships in the binary", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name))).sort();

  test("is exactly the folder on disk, so the firmware that was built and proven is the firmware that ships", () => {
    expect(Object.keys(MODULE_FILES).sort()).toEqual(files(MODULE_ON_DISK));
    for (const [path, content] of Object.entries(MODULE_FILES)) expect(content).toBe(readFileSync(join(MODULE_ON_DISK, path), "utf8"));
  });

  test("is written fresh beside the checkout: a file left from another version is gone", async () => {
    const dir = tempDir();
    await Bun.write(join(dir, MODULE_DIR, "src", "stale.c"), "int stale;");
    const out = await writeModule(dir);
    expect(files(out)).toEqual(Object.keys(MODULE_FILES).sort());
  });

  test("the firmware and the host agree on the baud rates, the behavior name, the overlay and the serial layout", () => {
    const c = readFileSync(join(MODULE_ON_DISK, "src/handsfree.c"), "utf8");
    expect(c).toContain(`#define LOCAL_BAUD ${LOCAL_BAUD}`);
    expect(c).toContain(`#define RELAY_BAUD ${RELAY_BAUD}`);
    expect(c).toContain('.behavior_dev = "bootload"');
    expect(c).toContain("DT_NODELABEL(keyloom_cdc_acm)");
    expect(MODULE_FILES[OVERLAY_FILE]).toContain("keyloom_cdc_acm");
    expect(readFileSync(join(MODULE_ON_DISK, "src/serial.c"), "utf8")).toContain("#define HALF_LETTER_AT 21");
  });

  test("the Glove80's Nix expression builds both halves with the module, the overlay and the per-half conf the generator writes", () => {
    expect(GLOVE80_NIX).toContain("module = ../keyloom-zmk;");
    expect(GLOVE80_NIX).toContain("extraModules = [ module ];");
    expect(GLOVE80_NIX).toContain(`-DEXTRA_DTC_OVERLAY_FILE=\${module}/${OVERLAY_FILE}`);
    expect(GLOVE80_NIX).toContain('half "glove80_lh" "L"');
    expect(GLOVE80_NIX).toContain('half "glove80_rh" "R"');
    // The per-half conf the expression reads is the file the generator writes for each half.
    expect(handsFreeOf(GLOVE80).halves.map((h) => halfConfFile(h.marker))).toEqual(["keyloom-L.conf", "keyloom-R.conf"]);
    expect(GLOVE80_NIX).toContain('/keyloom-${letter}.conf"');
    // The template's own default.nix, which this replaces, builds the same two halves from the same files.
    expect(GLOVE80_NIX).toContain('keymap = "${config}/glove80.keymap"');
    expect(GLOVE80_NIX).toContain("firmware.combine_uf2");
  });
});

describe("firmware artifacts", () => {
  test("a zip is read image by image, and a bundle with a half missing the marker is not a hands-free build", () => {
    const both = zipSync({ "left.uf2": uf2Carrying(serialOf(KEY, "L"), 0xada52840), "right.uf2": uf2Carrying(serialOf(KEY, "L"), 0xada52840) });
    expect(keyInArtifact(both)).toBe(KEY);
    const oneBare = zipSync({ "left.uf2": uf2Carrying(serialOf(KEY, "L"), 0xada52840), "right.uf2": uf2Carrying(undefined, 0xada52840) });
    expect(keyInArtifact(oneBare)).toBeUndefined();
    const mixed = zipSync({ "left.uf2": uf2Carrying(serialOf(KEY, "L"), 0xada52840), "right.uf2": uf2Carrying(serialOf(OLD_KEY, "L"), 0xada52840) });
    expect(keyInArtifact(mixed)).toBeUndefined();
    expect(keyInArtifact(new Uint8Array([0x50, 0x4b, 1, 2, 3]))).toBeUndefined();
    expect(keyInArtifact(glove80Image(KEY))).toBe(KEY);
  });

  test("the build log says whether the firmware carries the key the conf asked for", () => {
    const files = [{ content: `CONFIG_USB_DEVICE_SN="keyloom/${KEY}-L:0123456789ABCDEF"\n` }];
    expect(moduleReport(files, glove80Image(KEY))).toContain(`carries keyloom's hands-free module (build key ${KEY})`);
    expect(moduleReport(files, glove80Image(OLD_KEY))).toContain(`does not carry the build key ${KEY}`);
    expect(moduleReport([{ content: "# plain\n" }], glove80Image(KEY))).toBeUndefined();
  });
});

describe("west builds with the module (Corne)", () => {
  test("the script adds the module and the overlay to every target, and only when the board has a recipe", () => {
    const build = zmkRevision(CORNE.definition).build;
    if (build.kind !== "zmk-west-docker") throw new Error("the Corne builds with west");
    const script = westScript(build, true);
    expect(script.match(/-DZMK_EXTRA_MODULES=\/work\/keyloom-zmk -DEXTRA_DTC_OVERLAY_FILE=\/work\/keyloom-zmk\/keyloom-cdc-acm\.overlay/g)).toHaveLength(2);
    expect(westScript(build)).not.toContain("keyloom-zmk");
    expect(moduleFlags()).toContain("-DZMK_EXTRA_MODULES=/work/keyloom-zmk");
  });

  test("a build writes the module and the conf, runs west with the flags, and a plain generate's missing marker is reported", async () => {
    const dir = tempDir();
    const uf2 = join(dir, "one.uf2");
    await Bun.write(uf2, uf2Image(0xada52840, 4));
    const bin = fakeBinDir({
      docker: `echo "$@" >> "$FAKE_DOCKER_LOG"
vol=""; prev=""
for a in "$@"; do [ "$prev" = "-v" ] && vol="\${a%%:/work}"; prev="$a"; done
${fakeSha256Probe("/work")}
case " $* " in *" test -f config/west.yml "*) exit 0;; esac
for t in left right; do mkdir -p "$vol/build/$t/zephyr"; cp "$FAKE_UF2" "$vol/build/$t/zephyr/zmk.uf2"; done; exit 0`,
    });
    const imported = await importZmkSource(`${ROOT}/test/fixtures/zmk/corne`, CORNE.definition);
    const build = zmkRevision(CORNE.definition).build;
    const source = generateZmkSource({
      layout: imported.layout, board: CORNE.definition, geometry: CORNE.geometry, revisionId: "rev_x", keymapName: build.kind === "zmk-west-docker" ? build.keymapName : "corne",
      handsFree: { buildId: BUILD, config: handsFreeOf(CORNE) },
    });
    const lines: string[] = [];
    await withPath(bin, () =>
      buildZmkWest({
        board: CORNE.definition, source, checkoutDir: join(dir, "work"), imageContextDir: join(dir, "image"), artifactPath: join(dir, "out.zip"),
        log: new LogSink(join(dir, "b.log")), containerName: "k", onLine: (l) => lines.push(l),
      }), { FAKE_DOCKER_LOG: join(dir, "docker.calls"), FAKE_UF2: uf2 });
    expect(files(join(dir, "work", MODULE_DIR))).toEqual(Object.keys(MODULE_FILES).sort());
    expect(await Bun.file(join(dir, "work", "config", "corne.conf")).text()).toContain(`CONFIG_USB_DEVICE_SN="keyloom/${KEY}-L:0123456789ABCDEF"`);
    expect(await Bun.file(join(dir, "docker.calls")).text()).toContain("-DZMK_EXTRA_MODULES=/work/keyloom-zmk");
    expect(lines.some((l) => l.includes("does not carry the build key"))).toBe(true);
  });

  const files = (dir: string): string[] =>
    readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name))).sort();
});

describe("the Glove80 build with the module (fake docker)", () => {
  test("a source made without a build ID leaves empty per-half confs, so no marker from an earlier build is reused", async () => {
    const dir = tempDir();
    const repo = templateRepo();
    const board = boardWithTemplate(GLOVE80.definition, repo);
    const checkout = join(dir, "checkout");
    await Bun.$`git clone --quiet ${repo.dir} ${checkout}`.quiet();
    await Bun.$`git -C ${checkout} checkout --quiet --detach ${repo.sha}`.quiet();
    await Bun.write(join(checkout, "config", "keyloom-L.conf"), `CONFIG_USB_DEVICE_SN="keyloom/OLDOLDOLDOLD-L:GLV80-0123456789ABCDEF"\n`);
    const uf2 = join(dir, "g.uf2");
    await Bun.write(uf2, combinedUf2());
    const bin = fakeBinDir({
      docker: `case "$1" in version) echo 28.0.0; exit 0;; image) exit 0;; esac
vol=""; prev=""
for a in "$@"; do [ "$prev" = "-v" ] && vol="\${a%%:/config}"; prev="$a"; done
${fakeSha256Probe("/config")}
case " $* " in *" --entrypoint sh "*) exit 0;; esac
cp "$FAKE_UF2" "$vol/glove80.uf2"; exit 0`,
      git: `exec /usr/bin/git "$@"`,
    });
    const imported = await importZmkSource(TEMPLATE_FIXTURE, GLOVE80.definition);
    const source = generateZmkSource({ layout: imported.layout, board: GLOVE80.definition, geometry: GLOVE80.geometry, revisionId: "rev_x" });
    await withPath(bin, () =>
      buildZmk({
        board, source, checkoutDir: checkout, imageContextDir: join(dir, "image"), artifactPath: join(dir, "out.uf2"), log: new LogSink(join(dir, "b.log")), containerName: "k",
      }), { FAKE_UF2: uf2 });
    expect(await Bun.file(join(checkout, "config", "keyloom-L.conf")).text()).toBe("# keyloom: no build marker\n");
    expect(await Bun.file(join(checkout, "config", "keyloom-R.conf")).text()).toBe("# keyloom: no build marker\n");
    expect(await Bun.file(join(checkout, "config", "default.nix")).text()).toBe(GLOVE80_NIX);
    expect(await Bun.file(join(checkout, MODULE_DIR, "Kconfig")).exists()).toBe(true);
  });
});
