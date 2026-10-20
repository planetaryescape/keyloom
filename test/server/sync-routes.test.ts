// The sync routes and the events stream, over a real engine with fake build and flash: the stream opens with the current state and carries
// every change after it, writes need the token and a JSON body, and a request the engine refuses comes back as a usage error with its reason.
import { afterAll, afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { SyncEventSchema, SyncNowResponseSchema, SyncStatusResponseSchema, type BoardSync } from "../../src/api/http.ts";
import { appSyncBackend } from "../../src/cli/sync-backend.ts";
import { handleSyncRoute } from "../../src/server/sync-routes.ts";
import { BOARD, type SyncWorld, gate, skewedClock, syncWorld, waitFor } from "../helpers/fake-sync.ts";

// waitFor can run up to 15 s on a slow runner (fake-sync.ts); bun's 5 s default would cut it off first.
setDefaultTimeout(20_000);

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
let worlds: SyncWorld[] = [];
afterAll(() => servers.forEach((s) => s.stop(true)));
afterEach(async () => {
  for (const w of worlds) await w.stopAll();
  worlds = [];
});

async function serve(opts: Parameters<typeof syncWorld>[0] = {}) {
  const w = await syncWorld(opts);
  worlds.push(w);
  w.flashed();
  const engine = w.engine();
  await engine.start();
  const backend = appSyncBackend(engine);
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: async (request) => (await handleSyncRoute(request, new URL(request.url).pathname, backend, TOKEN)) ?? new Response("not a sync route", { status: 404 }),
  });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), "content-type": "application/json", ...init.headers } });
  return { w, engine, call };
}

/** Reads the stream's frames as they arrive. */
function frames(res: Response) {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const got: BoardSync[][] = [];
  let comments = 0;
  let pending = "";
  void (async () => {
    for (;;) {
      // A request aborted by the test ends the read with an error, which is the stream closing.
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      pending += decoder.decode(value);
      for (let end = pending.indexOf("\n\n"); end >= 0; end = pending.indexOf("\n\n")) {
        const raw = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (raw.startsWith(":")) comments++;
        else got.push(SyncEventSchema.parse(JSON.parse(raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "null")).boards);
      }
    }
  })();
  return { got, comments: () => comments, cancel: () => reader.cancel() };
}

describe("GET /api/sync", () => {
  test("needs the token and returns each board's state", async () => {
    const { call } = await serve();
    expect((await call("/api/sync", {}, null)).status).toBe(401);
    const res = await call("/api/sync");
    expect(res.status).toBe(200);
    const body = SyncStatusResponseSchema.parse(await res.json());
    expect(body.boards).toHaveLength(1);
    expect(body.boards[0]).toMatchObject({ boardId: BOARD, boardName: "Moonlander", state: { kind: "in_sync" }, auto: { on: true, proven: true } });
  });

  test("a wrong method is 405", async () => {
    const { call } = await serve();
    expect((await call("/api/sync", { method: "DELETE" })).status).toBe(405);
    expect((await call("/api/events", { method: "POST", body: "{}" })).status).toBe(405);
  });
});

describe("GET /api/events", () => {
  test("needs the token", async () => {
    const { call } = await serve();
    expect((await call("/api/events", {}, null)).status).toBe(401);
  });

  test("opens with the current state, then carries syncing steps to in sync as an Apply is synced", async () => {
    // The engine runs on a clock the test moves and looks only when told: "behind" lasts as long as the quiet time, which a loaded
    // runner can let pass between two of the engine's own timer ticks, so the frame for it was sometimes never sent.
    const clock = skewedClock();
    const QUIET = 10_000;
    const { w, engine, call } = await serve({ engine: { quietMs: QUIET, tickMs: 600_000, now: clock.now } });
    const res = await call("/api/events");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const stream = frames(res);
    await waitFor(() => stream.got.length >= 1, "the first frame");
    expect(stream.got[0]?.[0]?.state.kind).toBe("in_sync");
    w.world.flashGate = gate();
    w.apply();
    await engine.tick();
    await waitFor(() => stream.got.some((b) => b[0]?.state.kind === "behind"), "behind");
    clock.advance(QUIET);
    await engine.tick();
    await waitFor(() => stream.got.some((b) => b[0]?.state.kind === "syncing"), "syncing");
    w.world.flashGate.open();
    await waitFor(() => stream.got.at(-1)?.[0]?.state.kind === "in_sync", "in sync again");
    const kinds = stream.got.map((b) => b[0]?.state.kind);
    expect(kinds.indexOf("behind")).toBeLessThan(kinds.indexOf("syncing"));
    expect(stream.got.at(-1)?.[0]?.last).toMatchObject({ status: "succeeded" });
    await stream.cancel();
  });

  test("a closed stream stops listening", async () => {
    const clock = skewedClock();
    const { w, engine, call } = await serve({ engine: { quietMs: 10_000, tickMs: 600_000, now: clock.now } });
    // Counts the engine's listeners, so the test waits for the server to drop this stream's rather than sleeping and hoping it has.
    let listening = 0;
    const subscribe = engine.subscribe.bind(engine);
    engine.subscribe = (listener) => {
      listening++;
      const off = subscribe(listener);
      return () => {
        listening--;
        off();
      };
    };
    // Aborting the request closes the connection. Cancelling the reader only stops the client reading: Bun keeps the socket open
    // until the server stops, so a test that cancelled the reader would pass whether or not the server had dropped its listener.
    const closing = new AbortController();
    const stream = frames(await call("/api/events", { signal: closing.signal }));
    await waitFor(() => stream.got.length >= 1, "the first frame");
    expect(listening).toBe(1);
    closing.abort();
    await waitFor(() => listening <= 0, "the server to drop the stream's listener");
    const before = stream.got.length;
    w.apply();
    await engine.tick();
    expect(engine.views()[0]?.state.kind).toBe("behind");
    expect(stream.got.length).toBe(before);
    expect(engine.views()).toHaveLength(1);
  });
});

describe("writes", () => {
  test("POST /api/sync starts a sync and returns 202 with the boards", async () => {
    const { w, call } = await serve({ proven: false });
    w.apply();
    const res = await call("/api/sync", { method: "POST", body: JSON.stringify({ layoutId: w.layoutId }) });
    expect(res.status).toBe(202);
    expect(SyncNowResponseSchema.parse(await res.json()).result).toBe("started");
    await waitFor(() => w.calls.flashes.length === 1, "the flash");
  });

  test("a refusal is a usage error with its reason, not a 500", async () => {
    const { w, call } = await serve();
    w.world.reading = { state: "other", detail: "USB serial QxKPz/zLQ3Md" };
    const res = await call("/api/sync", { method: "POST", body: JSON.stringify({ layoutId: w.layoutId }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "usage", message: expect.stringContaining("never replaces that by itself") } });
    const missing = await call("/api/sync", { method: "POST", body: JSON.stringify({ layoutId: "lay_nope" }) });
    expect(missing.status).toBe(404);
  });

  test("auto-sync can't be turned on before it is proven, and pause and off are remembered", async () => {
    const { w, engine, call } = await serve({ proven: false });
    const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
    const refused = await post("/api/sync/auto", { boardId: BOARD, enabled: true });
    expect(refused.status).toBe(400);
    expect((await refused.json() as { error: { message: string } }).error.message).toContain("auto-sync can turn on once keyloom has flashed this board by itself");
    const paused = SyncStatusResponseSchema.parse(await (await post("/api/sync/pause", { boardId: BOARD, paused: true })).json());
    expect(paused.boards[0]?.auto.paused).toBe(true);
    expect(engine.settings(BOARD).paused).toBe(true);
    expect((await post("/api/sync/pause", { boardId: "nope/board", paused: true })).status).toBeGreaterThanOrEqual(400);
    void w;
  });

  test("writes need JSON and a valid body", async () => {
    const { call, w } = await serve();
    expect((await call("/api/sync", { method: "POST", body: "x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("/api/sync", { method: "POST", body: "{}" })).status).toBe(400);
    expect((await call("/api/sync", { method: "POST", body: "{", headers: {} })).status).toBe(400);
    expect((await call("/api/sync/auto", { method: "POST", body: JSON.stringify({ boardId: BOARD, enabled: "yes" }) })).status).toBe(400);
    expect((await call("/api/sync", { method: "POST", body: JSON.stringify({ layoutId: w.layoutId }) }, null)).status).toBe(401);
  });

  test("GET /api/events relays layout.updated events", async () => {
    let notifyUpdated: ((event: { type: "layout.updated"; layoutId: string; revisionId?: string }) => void) | undefined;
    const backend = {
      status: async () => [],
      syncNow: async () => ({ result: "in_sync" as const, boards: [] }),
      setAutoSync: async () => [],
      setPaused: async () => [],
      disableRemapping: async () => [],
      subscribe: () => () => {},
      newKeyboards: () => [],
      subscribeLayoutUpdated: (listener: (event: { type: "layout.updated"; layoutId: string; revisionId?: string }) => void) => {
        notifyUpdated = listener;
        return () => { notifyUpdated = undefined; };
      },
    };
    const server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch: async (request) => (await handleSyncRoute(request, new URL(request.url).pathname, backend, TOKEN)) ?? new Response(null, { status: 404 }),
    });
    servers.push(server);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/events`, { headers: { "x-keyloom-token": TOKEN } });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = "";

    void (async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        text += decoder.decode(value);
      }
    })();

    await waitFor(() => notifyUpdated !== undefined, "subscription");
    notifyUpdated!({ type: "layout.updated", layoutId: "lay_123", revisionId: "rev_abc" });

    await waitFor(() => text.includes("event: layout.updated") && text.includes("lay_123"), "layout.updated frame");

    expect(text).toContain("event: layout.updated");
    expect(text).toContain('"layoutId":"lay_123"');
    await reader.cancel();
  });
});
