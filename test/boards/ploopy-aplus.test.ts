import { expect, test } from "bun:test";
import { readDefaultKeymap } from "../../src/app/default-keymap.ts";
import { generateGeometry } from "../../src/boards/geometry.ts";
import { loadBoardDir } from "../../src/boards/load.ts";
import { generateQmkSource } from "../../src/firmware/qmk/generate.ts";
import { tempDir } from "../helpers/tmp.ts";

const board = await loadBoardDir(`${import.meta.dir}/../../boards/ploopy/aplus`);
const fixture = `${import.meta.dir}/../fixtures/qmk/ploopy-aplus-default`;
const tree = async (url: string) => {
  const file = Bun.file(`${fixture}/${url.split("/").at(-1)}`);
  if (!await file.exists()) throw new Error(`GET ${url} returned 404`);
  return file.text();
};

test("the A+ derives all eight buttons from Ploopy's Hjson and uses its own USB identity", async () => {
  const rev = board.definition.revisions[0]!;
  const geometry = await generateGeometry(board.definition, rev, { fetchText: tree });
  expect(geometry).toEqual(board.geometry);
  expect(rev.detect).toMatchObject({ usbVendorId: "0x5043", usbProductId: "0x81db", products: ["Ploopy A+ Trackball"] });
  expect(board.definition.hands).toEqual({ left: [], right: [0, 1, 2, 3, 4, 5, 6, 7] });
});

test("each A+ print area stays inside its physical button, including the concave edges", () => {
  for (const shape of Object.values(board.definition.display!.keyShapes!)) {
    const area = shape.printArea!;
    for (const x of [area.x, area.x + area.w / 2, area.x + area.w]) {
      for (const y of [area.y, area.y + area.h / 2, area.y + area.h]) {
        if (shape.outline === undefined) {
          expect((x - 0.5) ** 2 + (y - 0.5) ** 2).toBeLessThan(0.25);
          continue;
        }
        let inside = false;
        for (let i = 0, j = shape.outline.length - 1; i < shape.outline.length; j = i++) {
          const [ax, ay] = shape.outline[i]!;
          const [bx, by] = shape.outline[j]!;
          if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
        }
        expect(inside).toBe(true);
      }
    }
  }
});

test("the factory config retains the gesture, wheel and VIA source when one button changes", async () => {
  const found = await readDefaultKeymap(board.definition, { fetchText: tree, cacheDir: tempDir() });
  if (!found.layout) throw new Error(found.reason);
  const layout = found.layout;
  expect(layout.layers).toHaveLength(8);
  expect(layout.layers[0]!.bindings[7]).toEqual({ kind: "layer", action: "toggle", layerId: "layer-2" });
  layout.layers[0]!.bindings[0] = { kind: "key", code: "A" };
  const files = generateQmkSource({ layout, board: board.definition, revisionId: "test" }).files;
  const c = files.find((f) => f.path === "keymap.c")!.content;
  expect(c).toContain("KC_A,");
  expect(c).toContain('#include "../../../common/tmag5273wheel.h"');
  expect(c).toContain("pointing_device_gestures_trigger(uint8_t direction)");
  expect(c).toContain("tmag5273_get_angle(TMAG5273_D0_I2C_ADDRESS)");
  expect(c).toContain("uint32_t leftwheel_timeout = 0;");
  expect(c).toContain("} user_config_t;");
  expect(c).toContain("user_config_t user_config;");
  expect(c).toContain("PKC_TGL_MIRROR = SAFE_RANGE,");
  expect(c.indexOf("PKC_TGL_MIRROR = SAFE_RANGE,")).toBeLessThan(c.indexOf("keymaps[]"));
  expect(files.find((f) => f.path === "rules.mk")!.content).toContain("VIA_ENABLE = yes");
  expect(files.find((f) => f.path === "config.h")!.content).toContain("#define DYNAMIC_KEYMAP_LAYER_COUNT 8");
  expect(JSON.parse(files.find((f) => f.path === "keymap.json")!.content).modules).toEqual(["drashna/pointing_device_accel", "drashna/pointing_device_gestures"]);
});

test.each(["config.h", "rules.mk", "keymap.json"])("a failed %s download refuses the default instead of using the JSON fallback", async (companion) => {
  const requested: string[] = [];
  const found = await readDefaultKeymap(board.definition, {
    cacheDir: tempDir(),
    fetchText: (url) => {
      requested.push(url);
      if (url.endsWith(`/${companion}`)) throw new Error("GET returned 503");
      if (url.endsWith("/keymap.json")) return Promise.resolve(JSON.stringify({ layout: "LAYOUT", layers: [Array(8).fill("KC_A")] }));
      return tree(url);
    },
  });
  expect(found.layout).toBeNull();
  expect("reason" in found && found.reason).toContain(`couldn't read ${companion}`);
  expect("reason" in found && found.reason).toContain("503");
  expect(requested.filter((url) => url.endsWith("/keymap.json"))).toHaveLength(1);
});

test("a missing C default still permits a JSON default with layers", async () => {
  const found = await readDefaultKeymap(board.definition, {
    cacheDir: tempDir(),
    fetchText: async (url) => {
      if (url.endsWith("/keymap.c")) throw new Error("GET returned 404");
      return JSON.stringify({ layout: "LAYOUT", layers: [Array(8).fill("KC_A")] });
    },
  });
  expect(found.layout?.layers[0]?.bindings).toEqual(Array(8).fill({ kind: "key", code: "A" }));
  expect("from" in found && found.from).toContain("keymap.json");
});
