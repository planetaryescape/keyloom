// keyloom keyboard (22, 10#commands): detect, add and put through the real command parser, against a fake USB bus and the pinned
// firmware tree as fixtures. The JSON contract carries schema_version; a missing confirmation is a usage error (2) that writes nothing.
import { afterAll, describe, expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { importLayout, openApp } from "../../src/app/index.ts";
import { listBoards, setUserBoards } from "../../src/boards/registry.ts";
import type { UsbDevice } from "../../src/firmware/toolchain/usb.ts";
import { CORNE_LAYOUT_FIXTURE } from "../helpers/derive-sources.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";
import { tempDir } from "../helpers/tmp.ts";

afterAll(() => setUserBoards([]));

const corne: UsbDevice = { vendorId: "0x1d50", productId: "0x615e", name: "Corne", maker: "ZMK Project", serial: "ABCDEF" };
const glove: UsbDevice = { vendorId: "0x16c0", productId: "0x27db", name: "Glove80 Left", maker: "MoErgo", bcdDevice: "0x0305" };
const mouse: UsbDevice = { vendorId: "0x046d", productId: "0xc077", name: "USB Optical Mouse", maker: "Logitech" };

type Result = { code: number; out: string; err: string };
const json = (r: Result) => JSON.parse(r.out);

function harness(devices: UsbDevice[], hideCorne = true) {
  const dataDir = tempDir();
  const keyboards = {
    fetchText: async (url: string) => {
      if (url.endsWith("/app/dts/layouts/foostan/corne/6column.dtsi")) return Bun.file(CORNE_LAYOUT_FIXTURE).text();
      throw new Error(`GET ${url} returned 404`);
    },
    cacheDir: tempDir(),
    ...(hideCorne ? { boards: listBoards().filter((b) => b.definition.id !== "foostan/corne") } : {}),
  };
  const cli = async (...args: string[]): Promise<Result> => {
    let out = "";
    let err = "";
    const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
    const code = await runCli([...args, "--data-dir", dataDir], io, {}, { usb: async () => devices }, undefined, undefined, keyboards);
    return { code, out, err };
  };
  return { cli, dataDir };
}

describe("keyloom keyboard detect", () => {
  test("lists the keyboards on USB with their candidates, in JSON with schema_version, and leaves a mouse out", async () => {
    const { cli } = harness([mouse, corne]);
    const r = await cli("keyboard", "detect", "--format", "json");
    expect(r.code).toBe(0);
    const body = json(r);
    expect(body.schema_version).toBe(1);
    expect(body.keyboards).toHaveLength(1);
    expect(body.keyboards[0]).toMatchObject({
      device: { vendor_id: "0x1d50", product_id: "0x615e", product: "Corne", maker: "ZMK Project" },
      status: "candidates",
      known_board: null,
    });
    expect(body.keyboards[0].candidates.map((c: { id: string }) => c.id)).toContain("zmk:corne");
    expect(body.keyboards[0].next).toContain("--candidate zmk:corne");
  });

  test("names a board keyloom has, and says nothing is attached when nothing is", async () => {
    const known = await harness([glove], false).cli("keyboard", "detect", "--format", "json");
    expect(json(known).keyboards[0]).toMatchObject({ status: "known", known_board: { id: "moergo/glove80" }, device: { bcd_device: "0x0305" } });
    const none = await harness([mouse]).cli("keyboard", "detect", "--format", "table");
    expect(none.out).toContain("no QMK or ZMK keyboard is attached");
  });

  test("the table says why it thinks what it thinks", async () => {
    const r = await harness([corne]).cli("keyboard", "detect", "--format", "table");
    expect(r.out).toContain("zmk:corne");
    expect(r.out).toContain("default USB ID");
  });

  test("--search finds a keyboard USB could not name", async () => {
    const r = await harness([]).cli("keyboard", "detect", "--search", "kyria", "--format", "json");
    expect(json(r).candidates.map((c: { id: string }) => c.id)).toContain("zmk:kyria");
  });
});

describe("keyloom keyboard add and put", () => {
  test("add without the confirmations shows the rows and what is needed, stores nothing, and exits 2", async () => {
    const { cli, dataDir } = harness([corne]);
    const r = await cli("keyboard", "add", "--candidate", "zmk:corne", "--format", "json");
    expect(r.code).toBe(2);
    expect(json(r)).toMatchObject({ added: false, needs: ["--home-row", "--controller"], preview: { keyCount: 42, guessedHomeRow: 2 } });
    expect(r.err).toContain("--home-row");
    expect(await Bun.file(`${dataDir}/boards/local/corne/board.json`).exists()).toBe(false);
  });

  test("add with them stores the board, boards show finds it in a later command, and put proposes the Glove80 layout on it", async () => {
    const { cli, dataDir } = harness([corne]);
    const add = await cli("keyboard", "add", "--candidate", "zmk:corne", "--home-row", "2", "--controller", "nice_nano//zmk", "--format", "json");
    expect(add.code).toBe(0);
    expect(json(add)).toMatchObject({ schema_version: 1, added: true, board_id: "local/corne", home_row: 2, manual_flash_reason: null });
    expect(await Bun.file(`${dataDir}/boards/local/corne/board.json`).exists()).toBe(true);
    expect(await Bun.file(`${dataDir}/boards/local/corne/geometry.json`).exists()).toBe(true);

    // A later command, which never opens the database, still finds it.
    const shown = await cli("boards", "show", "local/corne", "--format", "json");
    expect(json(shown).board).toMatchObject({ id: "local/corne", keyCount: 42 });
    expect(json(await cli("boards", "list", "--format", "json")).boards.map((b: { id: string }) => b.id)).toContain("local/corne");

    const app = openApp({ dataDir });
    const glove80 = await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "my-glove80" });
    app.db.close();
    const put = await cli("keyboard", "put", "my-glove80", "--on", "local/corne", "--format", "json");
    expect(put.code).toBe(0);
    const body = json(put);
    expect(body.schema_version).toBe(1);
    expect(body.config).toMatchObject({ name: "my-glove80 on Corne", board_id: "local/corne" });
    expect(body.proposals).toHaveLength(2);
    expect(body.placements[0]).toMatchObject({ key: expect.stringContaining("Space hold Layer"), candidates: [{ place: "right thumb, inner" }, { place: "right thumb, middle" }, { place: "right thumb, outer" }] });
    expect(body.layers).toHaveLength(3);
    expect(body.not_carried.length).toBeGreaterThan(0);
    expect(glove80.layoutId).toMatch(/^lay_/);
    const changes = await cli("change", "list", body.config.id, "--format", "json");
    expect(json(changes).change_sets.map((c: { status: string }) => c.status)).toEqual(["proposed", "proposed"]);
  });

  test("put on a board that does not exist is not-found (3), and a layout that does not exist too", async () => {
    const { cli } = harness([]);
    expect((await cli("keyboard", "put", "nothing", "--on", "local/nowhere")).code).toBe(3);
  });

  test("an id the index does not have is a usage error that points at detect", async () => {
    const r = await harness([]).cli("keyboard", "add", "--candidate", "zmk:no-such-thing", "--home-row", "2");
    expect(r.code).toBe(2);
    expect(r.err).toContain("keyboard detect");
  });
});
