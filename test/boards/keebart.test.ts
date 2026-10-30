import { expect, test } from "bun:test";
import { loadBoardDir } from "../../src/boards/load.ts";
import { boardByUsbId } from "../../src/boards/derive/known.ts";
import { generateGeometry } from "../../src/boards/geometry.ts";
import { ZMK_LAYOUT } from "../helpers/board-recipes.ts";
import { generateZmkSource } from "../../src/firmware/zmk/generate.ts";
import { LayoutSchema } from "../../src/layout/schema.ts";
const board = await loadBoardDir("boards/keebart/corne-choc-pro-bt");

test("shared ZMK USB IDs require one of the Corne's product names", () => {
  const ids = { vendorId: "0x1d50", productId: "0x615e" };
  expect(boardByUsbId([board.definition], ids)).toBeUndefined();
  expect(boardByUsbId([board.definition], { ...ids, product: "Other keyboard" })).toBeUndefined();
  expect(boardByUsbId([board.definition], { ...ids, product: "Corne Choc BT" })?.id).toBe(board.definition.id);
  // Each half names itself apart while it runs, so both names still find the board.
  expect(boardByUsbId([board.definition], { ...ids, product: "Corne Choc BT L" })?.id).toBe(board.definition.id);
  expect(boardByUsbId([board.definition], { ...ids, product: "Corne Choc BT R" })?.id).toBe(board.definition.id);
});

test("geometry fetches the hardware module rather than upstream ZMK", async () => {
  const definition = structuredClone(board.definition);
  definition.keyCount = 4;
  const revision = definition.revisions[0]!;
  if (revision.build.kind !== "zmk-west-docker") throw Error("west recipe required");
  revision.build.physicalLayout = "layout.dtsi";
  let fetched = "";
  const geometry = await generateGeometry(definition, revision, { fetchText: async url => { fetched = url; return ZMK_LAYOUT; } });
  expect(fetched).toBe("https://raw.githubusercontent.com/Keebart/zmk-config/98c5a1181ff7db1f480f684f714126922d55b8f0/layout.dtsi");
  expect(geometry.source).toMatchObject({ repo: "https://github.com/Keebart/zmk-config", sha: "98c5a1181ff7db1f480f684f714126922d55b8f0" });
});

test("every layer carries the encoder bindings and selects the 46-position physical layout", () => {
  const layout = LayoutSchema.parse({ schemaVersion: 1, boardId: board.definition.id, firmware: "zmk", layers: [{id:"base",name:"Base",bindings:Array.from({length:46},()=>({kind:"key",code:"A"}))}], combos:[], macros:[], tapDances:[], holdTapProfiles:[], conditionalLayers:[], settings:[], passthrough:[] });
  const generated = generateZmkSource({ layout, board: board.definition, geometry: board.geometry, revisionId: "test", keymapName: "corne_choc_pro" });
  expect(generated.files[1]!.content).toContain("CONFIG_ZMK_STUDIO=n");
  const source = generated.files[0]!.content;
  expect(source).toContain("zmk,physical-layout = <&default_layout>");
  expect(source).toContain("sensor-bindings = <&inc_dec_kp C_VOL_UP C_VOL_DN &inc_dec_kp C_VOL_UP C_VOL_DN &inc_dec_kp C_BRI_UP C_BRI_DN &inc_dec_kp C_BRI_UP C_BRI_DN>");
});
