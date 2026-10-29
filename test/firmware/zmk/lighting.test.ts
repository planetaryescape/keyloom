import { expect, test } from "bun:test";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { LayoutSchema } from "../../../src/layout/schema.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmk } from "../../../src/firmware/zmk/import.ts";
import { matrixControls, renderZmkLighting } from "../../../src/firmware/zmk/emit-lighting.ts";
import { westManifest, westScript } from "../../../src/firmware/zmk/build-west.ts";

const { definition: board } = await loadBoardDir("boards/keebart/corne-choc-pro-bt");
function fixture() {
  return LayoutSchema.parse({ schemaVersion: 1, boardId: board.id, firmware: "zmk", macros: [], combos: [], holdTapProfiles: [], settings: [], passthrough: [], layers: [
    { id: "base", name: "Base", bindings: Array.from({ length: 46 }, () => ({ kind: "key", code: "A" })), lighting: { layer: [0,255,255], keys: { "42": [85,255,255], "43": [170,255,255] } } },
    { id: "dark", name: "Dark", bindings: Array.from({ length: 46 }, () => ({ kind: "transparent" })), lighting: {} },
    { id: "effects", name: "Effects", bindings: Array.from({ length: 46 }, () => ({ kind: "transparent" })) },
  ] });
}
const generate = (layout = fixture()) => generateZmkSource({ layout, board, revisionId: "test" });

test("LED order is separate for each half; key overrides beat the layer, explicit dark beats effects", () => {
  const source = renderZmkLighting(fixture(), board).join("\n");
  expect(source).toContain("led-colors = <0x02ff00 0xff0000");
  expect(source).toContain("led-colors = <0x0004ff 0xff0000");
  expect(source).toContain(`led-colors = <${Array(23).fill("0x000000").join(" ")}>`);
  expect(source.match(/only-topmost;/g)).toHaveLength(2);
  expect(source).not.toContain("klcond_2");
  expect(source).toContain("max-brightness = <30>");
  expect(source).toContain("#if KEYLOOM_RGB_LEFT");
  expect(source).toContain("#ifndef KEYLOOM_RGB_LEFT");
  expect(source).not.toContain("CONFIG_ZMK_SPLIT_ROLE_CENTRAL");
});

test("power and brightness control the matrix, hue and effects control the fallback effect", () => {
  expect(matrixControls("&rgb_ug RGB_TOG &rgb_ug RGB_BRD &rgb_ug RGB_HUI &rgb_ug RGB_COLOR_HSB(180, 100, 20)"))
    .toBe("&klrgb RGB_TOG &klrgb RGB_BRD &klfx RGB_HUI &klfx RGB_COLOR_HSB(180, 100, 20)");
  expect(() => matrixControls("&rgb_ug RGB_UNSUPPORTED")).toThrow("does not support");
});

test("the build manifest pins the RGB module and generation disables the competing strip driver", () => {
  const build = board.revisions[0]!.build;
  if (build.kind !== "zmk-west-docker") throw Error("west");
  expect(westManifest("https://example.com/zmk", "a".repeat(40), build.boardModule, build.rgbMatrix))
    .toContain("revision: 3166a4ec6801a5726f12a53e82cff92323116025");
  const commands = westScript(build).split("\n").filter((line) => line.startsWith("west build"));
  expect(commands[0]).toContain("-DDTS_EXTRA_CPPFLAGS=-DKEYLOOM_RGB_LEFT=1");
  expect(commands[1]).toContain("-DDTS_EXTRA_CPPFLAGS=-DKEYLOOM_RGB_LEFT=0");
  expect(generate().files[1]!.content).toContain("CONFIG_ZMK_RGB_UNDERGLOW=n");
});

test("per-key colours survive export/import exactly, including dark versus unspecified", async () => {
  const layout = fixture();
  layout.layers[0]!.bindings[0] = { kind: "native", firmware: "zmk", source: "&rgb_ug RGB_TOG", label: "TOG" };
  const source = generate(layout);
  const read = await importZmk({ name: "test", keymap: source.files[0]!.content, conf: source.files[1]!.content }, board);
  expect(read.layout.layers.map(l => l.lighting)).toEqual(layout.layers.map(l => l.lighting));
  expect(read.layout.layers[0]!.bindings[0]).toMatchObject({ source: "&rgb_ug RGB_TOG" });
  expect(generate(read.layout).files[0]!.content).toBe(source.files[0]!.content);
  await expect(importZmk({ name: "edited", keymap: source.files[0]!.content.replace("0x02ff00", "0x010203") }, board)).rejects.toThrow("edited");
});

test("unsupported or invalid maps cannot silently drop colours", () => {
  const missing = structuredClone(board);
  if (missing.revisions[0]!.build.kind === "zmk-west-docker") delete missing.revisions[0]!.build.rgbMatrix;
  expect(() => renderZmkLighting(fixture(), missing)).toThrow("no per-key");
  const wrongTarget = structuredClone(board);
  if (wrongTarget.revisions[0]!.build.kind === "zmk-west-docker") wrongTarget.revisions[0]!.build.rgbMatrix!.leftTarget = "absent";
  expect(() => renderZmkLighting(fixture(), wrongTarget)).toThrow("matching leftTarget");
  const duplicate = structuredClone(board);
  duplicate.lighting!.ledPositions[1] = duplicate.lighting!.ledPositions[0]!;
  expect(() => renderZmkLighting(fixture(), duplicate)).toThrow("unique");
});


test("native emulation removes hardware RGB nodes and neutralises their controls", async () => {
  const { readZmkLighting } = await import("../../../src/firmware/zmk/import-lighting.ts");
  const { nativeFiles } = await import("../../../src/firmware/zmk/emulate-keymap.ts");
  const layout = fixture();
  layout.layers[0]!.bindings[0] = { kind: "native", firmware: "zmk", source: "&rgb_ug RGB_TOG", label: "TOG" };
  const source = generate(layout);
  const files = nativeFiles({ keymap: readZmkLighting(source.files[0]!.content, board).source, conf: source.files[1]!.content, keyCount: 46, events: [{ at: 0, position: 0, action: "press" }, { at: 10, position: 0, action: "release" }] });
  expect(files.keymap).not.toContain("keypaw,rgb");
  expect(files.keymap).not.toContain("&klrgb");
  expect(files.keymap).not.toContain("&rgb_ug");
  expect(files.conf).not.toContain("KEYLOOM_RGB_POWER");
});
