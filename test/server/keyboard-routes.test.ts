// The new-keyboard routes (src/api/keyboards.ts, D-336) over a real app, a fake USB Corne over ZMK's default ID and the pinned Corne layout
// from a fixture: the guard, detect and search, a preview that draws the board without storing it, the name it shows beside a board of the
// same name, add with its confirmations, and a put previewed, made with a chosen placement, and listed on the config's page.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProposalsResponseSchema } from "../../src/api/configs.ts";
import { ApiErrorBodySchema } from "../../src/api/http.ts";
import { AddResponseSchema, DetectResponseSchema, PreviewResponseSchema, PutPreviewResponseSchema, PutResponseSchema } from "../../src/api/keyboards.ts";
import { detectKeyboards, importLayout, openApp, newConfig } from "../../src/app/index.ts";
import { unzipSync, strFromU8 } from "fflate";
import type { SyncEngine } from "../../src/app/sync-engine.ts";
import { listBoards, setUserBoards } from "../../src/boards/registry.ts";
import { appConfigsBackend } from "../../src/cli/configs-backend.ts";
import { appKeyboardsBackend } from "../../src/cli/keyboards-backend.ts";
import type { UsbDevice } from "../../src/firmware/toolchain/usb.ts";
import { handleConfigRoute } from "../../src/server/config-routes.ts";
import { handleKeyboardRoute } from "../../src/server/keyboard-routes.ts";
import { CORNE_LAYOUT_FIXTURE } from "../helpers/derive-sources.ts";
import { tempDir } from "../helpers/tmp.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";

setDefaultTimeout(20_000);
afterAll(() => setUserBoards([]));

const TOKEN = "t".repeat(43);
const corne: UsbDevice = { vendorId: "0x1d50", productId: "0x615e", name: "Corne", maker: "ZMK Project", serial: "0123456789ABCDEF" };
const tree = async (url: string): Promise<string> => {
  if (url.endsWith("/app/dts/layouts/foostan/corne/6column.dtsi")) return Bun.file(CORNE_LAYOUT_FIXTURE).text();
  throw new Error(`GET ${url} returned 404`);
};
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => servers.forEach((s) => s.stop(true)));

async function serve(opts: { hideCommittedCorne?: boolean; fetchText?: (url: string) => Promise<string>; cacheDir?: string } = {}) {
  const app = openApp({ dataDir: tempDir() });
  const boards = opts.hideCommittedCorne === false ? listBoards() : listBoards().filter((b) => b.definition.id !== "foostan/corne");
  const found = await detectKeyboards({ usb: async () => [corne], boards });
  // The engine's side of it: what its last read saw. The routes never read USB themselves.
  const engine = { newKeyboards: () => found, notifyApplied: () => {} } as unknown as SyncEngine;
  const keyboards = appKeyboardsBackend(app, engine, { fetchText: opts.fetchText ?? tree, cacheDir: opts.cacheDir ?? tempDir(), boards });
  const configs = appConfigsBackend(app, engine);
  const server = Bun.serve({
    port: 0,
    fetch: async (r) => {
      const path = new URL(r.url).pathname;
      return (await handleKeyboardRoute(r, path, keyboards, TOKEN)) ?? (await handleConfigRoute(r, path, configs, TOKEN)) ?? new Response("no", { status: 404 });
    },
  });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), "content-type": "application/json", ...init.headers } });
  const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
  return { app, call, post };
}

describe("the guard", () => {
  test("collection writes are authenticated and schema-checked; a contribution contains only board files", async () => {
    const { app, call, post } = await serve();
    const config = newConfig(app, { name: "Collection synthetic", from: "blank", board: "foostan/corne" });
    expect((await call("/api/keyboards/collection", {}, null)).status).toBe(401);
    expect((await call("/api/keyboards/remove", { method: "POST", body: JSON.stringify({ board: "foostan/corne" }) }, null)).status).toBe(401);
    expect((await post("/api/keyboards/remove", { board: "foostan/corne", force: true })).status).toBe(400);
    expect((await post("/api/keyboards/remove", { board: "missing" })).status).toBe(404);
    const removed = await post("/api/keyboards/remove", { board: "foostan/corne" });
    expect(removed.status).toBe(200);
    expect((await removed.json()).removedAt).not.toBeNull();
    expect((await (await call("/api/keyboards/collection")).json()).keyboards[0]).toMatchObject({ boardId: "foostan/corne", layoutId: config.id });
    // R6-08: a config for a removed keyboard is refused with a code the page answers with Restore, by the put and by a new config alike.
    const elsewhere = newConfig(app, { name: "Collection elsewhere", from: "blank", board: "moergo/glove80" });
    const put = await post("/api/keyboards/put", { from: elsewhere.id, board: "foostan/corne" });
    expect(put.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await put.json()).error).toMatchObject({ code: "keyboard_removed", board: "foostan/corne" });
    const created = await post("/api/configs", { from: "blank", name: "Collection second", board: "foostan/corne" });
    expect(created.status).toBe(400);
    const createdError = ApiErrorBodySchema.parse(await created.json()).error;
    expect(createdError.code).toBe("keyboard_removed");
    expect(createdError.message).toContain("keyloom keyboard restore foostan/corne");
    expect((await (await post("/api/keyboards/restore", { board: "foostan/corne" })).json())).toMatchObject({ removedAt: null, paused: true });
    const bundle = await post("/api/keyboards/contribute", { board: "foostan/corne" });
    expect(bundle.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await bundle.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["CONTRIBUTION.md", "boards/foostan/corne/board.json", "boards/foostan/corne/geometry.json"]);
    expect(strFromU8(files["CONTRIBUTION.md"]!)).toContain("/add-keyboard");
    app.db.close();
  });
  test("every route needs the token, a write needs JSON, and the wrong method is refused", async () => {
    const { call } = await serve();
    expect((await call("/api/keyboards/detect", {}, null)).status).toBe(401);
    expect((await call("/api/keyboards/preview", { method: "POST", body: "x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("/api/keyboards/detect", { method: "POST", body: "{}" })).status).toBe(405);
  });
});

describe("a Corne keyloom has never seen", () => {
  test("detect lists it with its candidates and reasons; search finds index entries by name", async () => {
    const { call } = await serve();
    const found = DetectResponseSchema.parse(await (await call("/api/keyboards/detect")).json());
    expect(found.keyboards[0]?.candidates[0]?.id).toBe("zmk:corne");
    expect(found.keyboards[0]?.candidates[0]?.reasons.join(" ")).toContain("default USB ID");
    expect(found.candidates).toEqual([]);
    const search = DetectResponseSchema.parse(await (await call("/api/keyboards/detect?search=sofle")).json());
    expect(search.candidates.some((c) => c.name.toLowerCase().includes("sofle"))).toBe(true);
  });

  test("preview draws the board with hands, fingers and the flash, and stores nothing", async () => {
    const { post, call } = await serve();
    const p = PreviewResponseSchema.parse(await (await post("/api/keyboards/preview", { candidate: "zmk:corne" })).json());
    expect(p.needs).toEqual(["--home-row", "--controller"]);
    expect(p.board?.keys).toHaveLength(42);
    expect(p.board?.homeRow).toBe(2);
    expect(p.board?.hands.left).toHaveLength(21);
    expect(p.board?.fingers["13"]).toBe("left-pinky");
    expect(p.board?.thumbs).toEqual([36, 37, 38, 39, 40, 41]);
    // With no controller given, the drawing assumes the first that fits, and says so.
    expect(p.board?.assumedController).toBe(p.controllers[0]?.id ?? null);
    // keyloom ships a Corne board, so the derived one is told apart by name.
    expect(p.displayName).toBe("Corne (new)");
    const chosen = PreviewResponseSchema.parse(await (await post("/api/keyboards/preview", { candidate: "zmk:corne", homeRow: 1, controller: "nice_nano//zmk" })).json());
    expect(chosen.board?.homeRow).toBe(1);
    expect(chosen.board?.flash.kind).toBe("uf2-drives");
    expect(chosen.board?.flash.manualReason).toBeNull();
    expect(chosen.board?.assumedController).toBeNull();
    // Nothing was stored: the same keyboard is still offered.
    expect(DetectResponseSchema.parse(await (await call("/api/keyboards/detect")).json()).keyboards).toHaveLength(1);
  });

  // R5-06: the page gets a code for a keyboard keyloom can't add yet, not only the CLI's sentence with its flags.
  // R6-07: a keyboard keyloom has answers with board_known and the board, so the page offers to put a config on it.
  test("a keyboard keyloom can't add answers 400 with its code, and a preview always carries layouts and a problem code", async () => {
    const { post } = await serve();
    const known = await post("/api/keyboards/preview", { candidate: "zmk:glove80" });
    expect(known.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await known.json()).error).toMatchObject({ code: "board_known", board: "moergo/glove80", boardName: "Glove80" });
    const p = PreviewResponseSchema.parse(await (await post("/api/keyboards/preview", { candidate: "zmk:corne" })).json());
    expect(p.layouts).toEqual([]);
    expect(p.boardProblemCode).toBeNull();
  });

  // R7-11: a derived board that fails the boards check keeps its code, so the page shows the guide instead of Add again.
  test("a derived board that fails the boards check answers 400 board_check_failed", async () => {
    // No cache, and a layout file that reads differently the second time, so the check disagrees with the board it checks.
    const cacheDir = join(tempDir(), "not-a-folder");
    writeFileSync(cacheDir, "");
    let reads = 0;
    const drifting = async (url: string): Promise<string> => {
      const text = await tree(url);
      return ++reads === 1 ? text : text.replace("<&key_physical_attrs 100 100    0   37", "<&key_physical_attrs 100 100    0   97");
    };
    const { post } = await serve({ fetchText: drifting, cacheDir });
    const refused = await post("/api/keyboards/add", { candidate: "zmk:corne", homeRow: 2, controller: "nice_nano//zmk" });
    expect(refused.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await refused.json()).error.code).toBe("board_check_failed");
  });

  test("add needs the home row, refuses a controller that doesn't fit, and stores the board", async () => {
    const { post } = await serve();
    expect((await post("/api/keyboards/add", { candidate: "zmk:corne", controller: "nice_nano//zmk" })).status).toBe(400);
    const wrong = await post("/api/keyboards/add", { candidate: "zmk:corne", homeRow: 2, controller: "xiao_ble//zmk" });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: { message: string } }).error.message).toContain("Controllers that do");
    const added = await post("/api/keyboards/add", { candidate: "zmk:corne", homeRow: 2, controller: "nice_nano//zmk" });
    expect(added.status).toBe(201);
    expect(AddResponseSchema.parse(await added.json())).toMatchObject({ boardId: "local/corne", name: "Corne", displayName: "Corne (new)" });
  });
});

describe("putting BK's Glove80 setup on it", () => {
  test("a preview shows the mapped board and the placements; the put makes a config whose proposals the config page lists", async () => {
    const { app, post, call } = await serve();
    await post("/api/keyboards/add", { candidate: "zmk:corne", homeRow: 2, controller: "nice_nano//zmk" });
    const glove = await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "my-glove80" });

    const preview = PutPreviewResponseSchema.parse(await (await post("/api/keyboards/put/preview", { from: glove.layoutId, board: "local/corne" })).json());
    expect(preview.name).toBe("my-glove80 on Corne");
    expect(preview.after.boardId).toBe("local/corne");
    expect(preview.after.layers.map((l) => l.name)).toEqual(["Base", "layer_Nav", "layer_Magic"]);
    const placeable = preview.placements.find((p) => p.blocked === undefined && p.candidates.length > 1);
    expect(placeable).toBeDefined();
    // Nothing was made by the preview.
    expect((await call(`/api/configs?board=local/corne`).then((r) => r.json()) as { configs: unknown[] }).configs).toEqual([]);

    const choice = placeable === undefined ? {} : { [String(placeable.source)]: (placeable.candidates[1] as { target: number }).target };
    const made = await post("/api/keyboards/put", { from: glove.layoutId, board: "local/corne", placements: choice });
    expect(made.status).toBe(201);
    const out = PutResponseSchema.parse(await made.json());
    expect(out.config.boardId).toBe("local/corne");
    const listed = ProposalsResponseSchema.parse(await (await call(`/api/configs/${out.config.id}/proposals`)).json());
    expect(listed.proposals.map((p) => p.changeSetId).sort()).toEqual(out.proposals.map((p) => p.changeSetId).sort());
    if (placeable !== undefined) {
      // The placed proposal puts the key where the person chose, not on keyloom's first choice.
      const placed = listed.proposals.find((p) => p.title.includes("placed"));
      const target = (placeable.candidates[1] as { target: number }).target;
      expect(placed?.ops.some((o) => o.op === "setBinding" && o.at.layerId === "base" && o.at.position === target)).toBe(true);
      expect(placed?.explanation).toContain(`on the ${(placeable.candidates[1] as { name: string }).name} key`);
    }
  });

  test("a put onto the board a config is already for is a usage error", async () => {
    const { app, post } = await serve();
    const glove = await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "my-glove80" });
    expect((await post("/api/keyboards/put/preview", { from: glove.layoutId, board: "moergo/glove80" })).status).toBe(400);
  });
});
