// The board review routes (src/api/review.ts) and the review frames on the events stream (D-340), over a real review engine with a
// scripted model: the token and JSON rules, each route's shape, and the agent's part arriving after the checks.
import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ReviewEventSchema, ReviewResponseSchema } from "../../src/api/review.ts";
import { ReviewEngine } from "../../src/app/review-engine.ts";
import { appReviewBackend } from "../../src/cli/review-backend.ts";
import { appSyncBackend } from "../../src/cli/sync-backend.ts";
import { handleReviewRoute } from "../../src/server/review-routes.ts";
import { handleSyncRoute } from "../../src/server/sync-routes.ts";
import { type SyncWorld, gate, syncWorld, waitFor } from "../helpers/fake-sync.ts";
import { finished, scriptedModel, submit } from "../helpers/review-world.ts";
import type { WorkloadDeps } from "../../src/app/workload.ts";
import { replayResult } from "../helpers/workload.ts";

setDefaultTimeout(20_000);

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
const engines: ReviewEngine[] = [];
let worlds: SyncWorld[] = [];
afterAll(() => servers.forEach((s) => s.stop(true)));
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop();
  for (const w of worlds) await w.stopAll();
  worlds = [];
});

async function serve(opts: { held?: boolean; workload?: WorkloadDeps } = {}) {
  const w = await syncWorld();
  worlds.push(w);
  w.flashed();
  const sync = w.engine();
  await sync.start();
  const model = scriptedModel([
    submit([{ kind: "hint", code: "layer-order", title: "Two layers are alike", body: "{layer:layer-0} and {layer:layer-1} share most keys.", layers: ["layer-0", "layer-1"] }]),
    finished,
  ]);
  const held = gate();
  const engine = new ReviewEngine(w.app, { model: async () => { if (opts.held) await held.promise; return model.model; }, ...(opts.workload ? { workload: opts.workload } : {}) }, { quietMs: 10_000, tickMs: 10_000 });
  engines.push(engine);
  const review = appReviewBackend(engine);
  const sync2 = appSyncBackend(sync, engine);
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      return (await handleReviewRoute(request, path, review, TOKEN)) ?? (await handleSyncRoute(request, path, sync2, TOKEN)) ?? new Response("not a route", { status: 404 });
    },
  });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), "content-type": "application/json", ...init.headers } });
  const post = (path: string, body: unknown = {}) => call(path, { method: "POST", body: JSON.stringify(body) });
  const read = async (path: string) => ReviewResponseSchema.parse(await (await call(path)).json());
  return { w, engine, held, call, post, read, base: `/api/layouts/${w.layoutId}/review` };
}

describe("the guard", () => {
  test("every route needs the token, and a write needs a JSON body", async () => {
    const { base, call, post } = await serve();
    expect((await call(base, {}, null)).status).toBe(401);
    expect((await call(base, {}, "wrong")).status).toBe(401);
    expect((await call(`${base}/run`, { method: "POST", body: "{}" }, null)).status).toBe(401);
    expect((await call(`${base}/run`, { method: "POST", body: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" } })).status).toBe(415);
    expect((await call(`${base}/run`, { method: "POST", body: "{" })).status).toBe(400);
    expect((await post(`${base}/run`, { force: "yes" })).status).toBe(400);
    expect((await post(`${base}/run`, { surprise: true })).status).toBe(400);
    expect((await post(`${base}/run`, { activities: null })).status).toBe(400);
    expect((await post(`${base}/run`, { activities: ["gaming"] })).status).toBe(400);
    expect((await post(`${base}/run`, { activities: ["prose", "prose"] })).status).toBe(400);
    expect((await call(base, { method: "POST", body: "{}" })).status).toBe(405);
    expect((await call(`${base}/run`)).status).toBe(405);
    expect((await call(`${base}/elsewhere`)).status).toBe(404);
  });
});

describe("the review", () => {
  test("selected activities reach the engine and the response retains unverified task evidence", async () => {
    const { base, post, read, w } = await serve({ workload: { replay: async () => replayResult([]) } });
    const response = await post(`${base}/run`, { activities: ["prose"] });
    expect(response.status).toBe(202);
    expect(ReviewResponseSchema.parse(await response.json()).workloadActivities).toEqual(["prose"]);
    await waitFor(() => (w.app.db.query("SELECT ai_status FROM board_reviews").get() as { ai_status: string }).ai_status === "done", "workload-backed review");
    const done = await read(base);
    expect(done.review?.workload).toMatchObject({ activities: ["prose"], status: "done", baseline: [{ id: "prose-prose", physicalKeydowns: null }] });
  });
  test("before any run there is none, and the head is named so the page can tell", async () => {
    const { w, read, base } = await serve();
    expect(await read(base)).toEqual({ layoutId: w.layoutId, headRevisionId: w.head(), review: null });
  });

  test("run answers with the checks at once, and the agent's part is in the review when it finishes", async () => {
    const { w, post, read, base, held } = await serve({ held: true });
    const res = await post(`${base}/run`);
    expect(res.status).toBe(202);
    const started = ReviewResponseSchema.parse(await res.json());
    expect(started.review).toMatchObject({ revisionId: w.head(), trigger: "manual", checks: { status: "done" }, ai: { status: "running", reason: null } });
    expect(started.review?.items.every((i) => i.source === "check")).toBe(true);

    held.open();
    await waitFor(() => (w.app.db.query("SELECT ai_status FROM board_reviews").get() as { ai_status: string }).ai_status === "done", "the agent's part");
    const done = await read(base);
    expect(done.review?.ai.status).toBe("done");
    expect(done.review?.items.at(-1)).toMatchObject({ source: "agent", kind: "hint", id: "agent:layer-order:layer-0,layer-1:", title: "Two layers are alike" });
  });

  test("it is found by name as well as by ID", async () => {
    const { w, read } = await serve();
    expect((await read("/api/layouts/synchronized/review")).layoutId).toBe(w.layoutId);
    const { call } = await serve();
    expect((await call("/api/layouts/nothing/review")).status).toBe(404);
  });

  test("an item is hidden and restored by its id, which is URL-encoded because it has colons and slashes in it", async () => {
    const { post, read, base, engine, w } = await serve();
    engine.review(w.layoutId, "manual");
    const first = (await read(base)).review?.items[0];
    expect(first).toBeDefined();
    const id = first?.id as string;

    const hidden = ReviewResponseSchema.parse(await (await post(`${base}/items/${encodeURIComponent(id)}/dismiss`)).json());
    expect(hidden.review?.items.find((i) => i.id === id)?.dismissedAt).toBeGreaterThan(0);
    const restored = ReviewResponseSchema.parse(await (await post(`${base}/items/${encodeURIComponent(id)}/restore`)).json());
    expect(restored.review?.items.find((i) => i.id === id)?.dismissedAt).toBeNull();

    const missing = await post(`${base}/items/${encodeURIComponent("check:nothing::")}/dismiss`);
    expect(missing.status).toBe(404);
    expect((await post(`${base}/items/${encodeURIComponent(id)}/dismiss`, { extra: 1 })).status).toBe(400);
  });
});

describe("the events stream", () => {
  test("carries a review frame when a review is made and when its agent part moves, beside the sync frames", async () => {
    const { w, engine, call } = await serve();
    const res = await call("/api/events");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const named: string[] = [];
    const statuses: string[] = [];
    let pending = "";
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        pending += decoder.decode(value);
        for (let end = pending.indexOf("\n\n"); end >= 0; end = pending.indexOf("\n\n")) {
          const raw = pending.slice(0, end);
          pending = pending.slice(end + 2);
          const name = raw.split("\n").find((l) => l.startsWith("event:"))?.slice(6).trim();
          if (name === undefined) continue;
          named.push(name);
          if (name === "review") statuses.push(ReviewEventSchema.parse(JSON.parse(raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "null")).aiStatus);
        }
      }
    })();
    await waitFor(() => named.includes("sync"), "the opening sync frame");

    engine.review(w.layoutId, "manual");
    await waitFor(() => statuses.includes("done"), "the review frames");
    expect(statuses).toEqual(["pending", "running", "done"]);
    await reader.cancel();
  });
});
