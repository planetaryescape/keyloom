// The new-keyboard routes (src/api/keyboards.ts, D-336) over a real app, a fake USB Corne over ZMK's default ID and the pinned Corne layout
// from a fixture: the guard, detect and search, a preview that draws the board without storing it, the name it shows beside a board of the
// same name, add with its confirmations, and a put previewed, made with a chosen placement, and listed on the config's page.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ProposalsResponseSchema } from "../../src/api/configs.ts";
import { AddResponseSchema, DetectResponseSchema, PreviewResponseSchema, PutPreviewResponseSchema, PutResponseSchema } from "../../src/api/keyboards.ts";
import { detectKeyboards, importLayout, openApp } from "../../src/app/index.ts";
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

async function serve(opts: { hideCommittedCorne?: boolean } = {}) {
  const app = openApp({ dataDir: tempDir() });
  const boards = opts.hideCommittedCorne === false ? listBoards() : listBoards().filter((b) => b.definition.id !== "foostan/corne");
  const found = await detectKeyboards({ usb: async () => [corne], boards });
  // The engine's side of it: what its last read saw. The routes never read USB themselves.
  const engine = { newKeyboards: () => found, notifyApplied: () => {} } as unknown as SyncEngine;
  const keyboards = appKeyboardsBackend(app, engine, { fetchText: tree, cacheDir: tempDir(), boards });
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
