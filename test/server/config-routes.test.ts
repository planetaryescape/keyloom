// The configs and versions routes (src/api/configs.ts), over a real app and engine with a fake keyboard: the token and JSON rules,
// every route's shape, and the refusals as the status and code the config switcher acts on.
import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { applyOps, getLayout } from "../../src/app/index.ts";
import { CompareResponseSchema, ConfigListResponseSchema, ConfigResponseSchema, NewConfigResponseSchema, VersionHistoryResponseSchema } from "../../src/api/configs.ts";
import { appConfigsBackend } from "../../src/cli/configs-backend.ts";
import { getBoardConfig } from "../../src/persistence/configs.ts";
import { handleConfigRoute } from "../../src/server/config-routes.ts";
import { BOARD, type SyncWorld, syncWorld } from "../helpers/fake-sync.ts";
import { defaultKeymapTree } from "../helpers/default-keymaps.ts";
import { setKey } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";

setDefaultTimeout(20_000);

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
let worlds: SyncWorld[] = [];
afterAll(() => servers.forEach((s) => s.stop(true)));
afterEach(async () => {
  for (const w of worlds) await w.stopAll();
  worlds = [];
});

// `quietMs` is how long an edit waits before the sync engine builds and flashes it. Tests that read version history must outlast any
// delay between their edits and the read, or the engine adds a version of the head in between (it did on a slow CI runner).
async function serve(opts: { quietMs?: number } = {}) {
  const w = await syncWorld();
  worlds.push(w);
  w.flashed();
  const engine = w.engine(opts.quietMs === undefined ? {} : { quietMs: opts.quietMs });
  await engine.start();
  const backend = appConfigsBackend(w.app, engine, { fetchText: defaultKeymapTree(), cacheDir: tempDir() });
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => (await handleConfigRoute(request, new URL(request.url).pathname, backend, TOKEN)) ?? new Response("not a config route", { status: 404 }),
  });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), "content-type": "application/json", ...init.headers } });
  const post = (path: string, body: unknown = {}) => call(path, { method: "POST", body: JSON.stringify(body) });
  return { w, call, post };
}

const edit = (w: SyncWorld, ref: string, code: string) =>
  applyOps(w.app, ref, { baseRevisionId: getLayout(w.app, ref).revision.id, ops: setKey(6, code), summary: `Layer 0, key 7: ${code}` }).revisionId;

describe("the guard", () => {
  test("every route needs the token, and a write needs a JSON body", async () => {
    const { w, call } = await serve();
    expect((await call("/api/configs", {}, null)).status).toBe(401);
    expect((await call(`/api/configs/${w.layoutId}/versions`, {}, "wrong")).status).toBe(401);
    const form = await call("/api/configs", { method: "POST", body: "name=x", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(415);
    expect((await call("/api/configs", { method: "POST", body: "{" })).status).toBe(400);
    expect((await call("/api/configs", { method: "DELETE" })).status).toBe(405);
    expect((await call("/api/elsewhere")).status).toBe(404);
  });
});

describe("configs", () => {
  test("list, create, rename, archive, restore and delete", async () => {
    const { w, call, post } = await serve();
    const list = ConfigListResponseSchema.parse(await (await call("/api/configs")).json());
    expect(list.configs).toMatchObject([{ id: w.layoutId, name: "synchronized", onKeyboard: true, archivedAt: null, copiedFrom: null }]);

    const created = await post("/api/configs", { from: "config", name: "Colemak", config: w.layoutId });
    expect(created.status).toBe(201);
    const colemak = ConfigResponseSchema.parse(await created.json()).config;
    expect(colemak).toMatchObject({ name: "Colemak", onKeyboard: false, copiedFrom: { layoutId: w.layoutId, layoutName: "synchronized" } });

    const blank = ConfigResponseSchema.parse(await (await post("/api/configs", { from: "blank", name: "Steno", board: BOARD })).json()).config;
    expect(blank.copiedFrom).toBeNull();

    expect(ConfigResponseSchema.parse(await (await post(`/api/configs/${colemak.id}/rename`, { name: "Colemak DH" })).json()).config.name).toBe("Colemak DH");
    expect(ConfigResponseSchema.parse(await (await post(`/api/configs/${encodeURIComponent("Colemak DH")}/archive`)).json()).config.archivedAt).toEqual(expect.any(Number));
    expect(ConfigListResponseSchema.parse(await (await call("/api/configs")).json()).configs).toHaveLength(2);
    expect(ConfigListResponseSchema.parse(await (await call(`/api/configs?archived=1&board=${encodeURIComponent(BOARD)}`)).json()).configs).toHaveLength(3);
    expect(ConfigResponseSchema.parse(await (await post(`/api/configs/${colemak.id}/restore`)).json()).config.archivedAt).toBeNull();
    expect((await post(`/api/configs/${colemak.id}/delete`, { name: "nope" })).status).toBe(400);
    expect((await post(`/api/configs/${colemak.id}/delete`, { name: "Colemak DH" })).status).toBe(200);
    expect(ConfigListResponseSchema.parse(await (await call("/api/configs")).json()).configs).toHaveLength(2);
  });

  test("a blank config says where it started, and a file becomes a config (the same importers as /api/import)", async () => {
    const { w, post } = await serve();
    const blank = await (await post("/api/configs", { from: "blank", name: "Steno", board: BOARD })).json();
    expect(blank.note).toContain("default keymap");
    expect(getLayout(w.app, blank.config.id).document.layers.length).toBeGreaterThan(1);
    const noDefault = await (await post("/api/configs", { from: "blank", name: "Plain", board: "foostan/corne" })).json();
    expect(noDefault.config.boardId).toBe("foostan/corne");

    const bytes = await Bun.file(`${import.meta.dir}/../fixtures/zmk/corne/corne.keymap`).arrayBuffer();
    const res = await post("/api/configs", { from: "import", name: "From file", board: "foostan/corne", filename: "corne.keymap", data: Buffer.from(bytes).toString("base64") });
    expect(res.status).toBe(201);
    const made = NewConfigResponseSchema.parse(await res.json()).config;
    expect(made).toMatchObject({ name: "From file", boardId: "foostan/corne", copiedFrom: null });
    expect(getLayout(w.app, made.id).revision.origin).toBe("import");
    // Refusals: a taken name, a file that isn't one, and one that is the wrong shape.
    const again = await post("/api/configs", { from: "import", name: "From file", board: "foostan/corne", filename: "corne.keymap", data: Buffer.from(bytes).toString("base64") });
    expect(again.status).toBe(400);
    expect((await again.json()).error.message).toContain("already exists");
    expect((await post("/api/configs", { from: "import", name: "Bad", board: "foostan/corne", filename: "notes.txt", data: "aGk=" })).status).toBe(400);
    expect((await post("/api/configs", { from: "import", name: "Bad", board: "foostan/corne", filename: "corne.keymap" })).status).toBe(400);
  });

  test("refusals carry the status and code the switcher acts on", async () => {
    const { w, post } = await serve();
    const dup = await post("/api/configs", { from: "config", name: "synchronized", config: w.layoutId });
    expect(dup.status).toBe(400);
    expect((await dup.json()).error).toMatchObject({ code: "usage", message: expect.stringContaining("already exists") });
    expect((await post("/api/configs", { from: "config", name: "x", config: "nope" })).status).toBe(404);
    expect((await post("/api/configs", { from: "config", name: "x" })).status).toBe(400);
    expect((await post(`/api/configs/${w.layoutId}/archive`)).status).toBe(400);
    expect((await post(`/api/configs/${w.layoutId}/delete`, { name: "synchronized" })).status).toBe(400);
    expect((await post("/api/configs/nope/rename", { name: "y" })).status).toBe(404);
    expect((await post(`/api/configs/${w.layoutId}/archive`, { extra: 1 })).status).toBe(400);
  });

  test("use makes the config the one on the keyboard and starts one sync; on a refusal the choice is unchanged", async () => {
    const { w, post } = await serve();
    const colemak = ConfigResponseSchema.parse(await (await post("/api/configs", { from: "config", name: "Colemak", config: w.layoutId })).json()).config;
    edit(w, colemak.id, "F18");
    const used = await post(`/api/configs/${colemak.id}/use`);
    expect(used.status).toBe(202);
    const body = await used.json();
    expect(body.result).toBe("started");
    expect(body.boards.find((b: { boardId: string }) => b.boardId === BOARD)).toMatchObject({ layoutId: colemak.id });
    expect(getBoardConfig(w.app.db, BOARD)).toBe(colemak.id);

    w.world.reading = { state: "absent" };
    const refused = await post(`/api/configs/${w.layoutId}/use`);
    expect(refused.status).toBe(400);
    expect(getBoardConfig(w.app.db, BOARD)).toBe(colemak.id);
  });
});

describe("versions", () => {
  test("history, naming, compare and restore", async () => {
    const { w, call, post } = await serve({ quietMs: 600_000 });
    const first = w.head();
    edit(w, w.layoutId, "F17");
    const head = edit(w, w.layoutId, "F18");
    // Longer than the default 40 ms quiet window, so an engine left on its default would have put the head on the keyboard by now.
    await Bun.sleep(150);

    const history = VersionHistoryResponseSchema.parse(await (await call(`/api/configs/${w.layoutId}/versions`)).json());
    expect(history.versions).toEqual([]);
    expect(history.pending).toHaveLength(3);

    const named = await (await post(`/api/configs/${w.layoutId}/versions/name`, { target: first, name: "the import" })).json();
    expect(named.version).toMatchObject({ name: "the import", putOnAt: null, revisionId: first });

    const compared = CompareResponseSchema.parse(await (await call(`/api/configs/${w.layoutId}/compare?to=${encodeURIComponent("the import")}`)).json());
    expect(compared).toMatchObject({ from: { id: first }, to: { id: head }, diff: { same: false, keys: [{ position: 6, layerId: "layer-0" }] } });
    expect((await call(`/api/configs/${w.layoutId}/compare`)).status).toBe(400);
    expect((await call(`/api/configs/${w.layoutId}/compare?to=nope`)).status).toBe(404);

    const restored = await post(`/api/configs/${w.layoutId}/versions/restore`, { target: "the import" });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ restoredRevisionId: first });
    expect(CompareResponseSchema.parse(await (await call(`/api/configs/${w.layoutId}/compare?to=${first}`)).json()).diff.same).toBe(true);
    expect((await post(`/api/configs/${w.layoutId}/versions/restore`, { target: "the import" })).status).toBe(400);

    const cleared = await (await post(`/api/configs/${w.layoutId}/versions/name`, { target: "the import", name: "" })).json();
    expect(cleared.version).toBeNull();
  });
});
