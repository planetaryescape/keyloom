import { afterAll, describe, expect, test } from "bun:test";
import { DecisionCardSchema } from "../../src/api/http.ts";
import { applyChange, getLayout, proposeChange, recordPriority } from "../../src/app/index.ts";
import { appDecisionsBackend } from "../../src/cli/decisions-backend.ts";
import { handleDecisionRoute } from "../../src/server/decisions-routes.ts";
import { createBuild, createFlash, finishBuild, finishFlash, newBuildId, newFlashId } from "../../src/persistence/builds.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { draft } from "../helpers/ops.ts";

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => servers.forEach((s) => s.stop(true)));

async function serve() {
  const ctx = await commandShiftApp();
  let now = Date.now();
  const backend = appDecisionsBackend(ctx.app, () => now);
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => (await handleDecisionRoute(request, new URL(request.url).pathname, backend, TOKEN)) ?? new Response("not a decisions route", { status: 404 }),
  });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), "content-type": "application/json", ...init.headers } });
  const applyChoice = () => {
    const cs = proposeChange(ctx.app, ctx.layoutId, {
      ops: [{ op: "setBinding", at: { layerId: "layer-0", position: 42 }, binding: { kind: "modifier", mods: ["LGUI", "LSFT"] } }],
      explanation: "x", source: "agent", decisionDraft: { ...draft({ reason: "left hand is free" }), sourceMessageIds: ["msg_1"] },
    });
    return applyChange(ctx.app, cs.id).decisionId as string;
  };
  return { ...ctx, call, applyChoice, setNow: (n: number) => void (now = n) };
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

describe("decisions routes", () => {
  test("list returns choices and priorities, newest first, without retired ones; needs the token", async () => {
    const { call, layoutId, app, applyChoice } = await serve();
    const id = applyChoice();
    const { decision: priority } = recordPriority(app, layoutId, { priorityKind: "pinned", statement: "keep Backspace", subject: { functions: ["key:BACKSPACE"] } });

    expect((await call(`/api/layouts/${layoutId}/decisions`, {}, null)).status).toBe(401);
    expect((await call("/api/layouts/nope/decisions")).status).toBe(404);
    const res = await call(`/api/layouts/${layoutId}/decisions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decisions: unknown[] };
    const cards = body.decisions.map((d) => DecisionCardSchema.parse(d));
    expect(cards.map((c) => c.id)).toEqual([priority.id, id]);
    expect(cards[1]).toMatchObject({ kind: "choice", status: "hypothesis", reason: "left hand is free", sourceMessageIds: ["msg_1"] });

    expect((await call(`/api/decisions/${priority.id}`, { method: "DELETE" })).status).toBe(204);
    const after = (await (await call(`/api/layouts/${layoutId}/decisions`)).json()) as { decisions: Array<{ id: string }> };
    expect(after.decisions.map((d) => d.id)).toEqual([id]);
    expect((await call("/api/decisions/dec_nope", { method: "DELETE" })).status).toBe(404);
  });

  test("PATCH edits the words and the status; an empty field or an unknown status is refused", async () => {
    const { call, applyChoice } = await serve();
    const id = applyChoice();
    const ok = await call(`/api/decisions/${id}`, json("PATCH", { reason: "my pinky knows it", status: "tried_helpful", scope: { apps: ["Figma"], habits: [] } }));
    expect(ok.status).toBe(200);
    expect(DecisionCardSchema.parse(await ok.json())).toMatchObject({ reason: "my pinky knows it", status: "tried_helpful", scope: { apps: ["Figma"], habits: [] } });
    expect((await call(`/api/decisions/${id}`, json("PATCH", { reason: "" }))).status).toBe(400);
    expect((await call(`/api/decisions/${id}`, json("PATCH", {}))).status).toBe(400);
    expect((await call(`/api/decisions/${id}`, json("PATCH", { status: "retired" }))).status).toBe(400);
    expect((await call("/api/decisions/dec_nope", json("PATCH", { goal: "x" }))).status).toBe(404);
    expect((await call(`/api/decisions/${id}`, { method: "PUT", body: "{}" })).status).toBe(405);
  });

  test("the outcome question appears a week after a flash, can be answered or dismissed, and is not asked twice", async () => {
    const { call, app, layoutId, applyChoice, setNow } = await serve();
    const id = applyChoice();
    const view = getLayout(app, layoutId);
    const startedAt = Date.now();
    const buildId = newBuildId();
    createBuild(app.db, { id: buildId, revisionId: view.revision.id, layoutId, boardRevision: "reva", logPath: "l", now: startedAt });
    finishBuild(app.db, buildId, { artifactPath: "a" }, startedAt + 1);
    const flashId = newFlashId();
    createFlash(app.db, { id: flashId, buildId, logPath: "l", now: startedAt + 2 });
    finishFlash(app.db, flashId, null, startedAt + 3);

    const questions = async () => ((await (await call(`/api/layouts/${layoutId}/outcome-questions`)).json()) as { questions: Array<{ decision: { id: string }; flashedAt: number }> }).questions;
    setNow(startedAt + 6 * 24 * 3600 * 1000);
    expect(await questions()).toEqual([]);
    setNow(startedAt + 8 * 24 * 3600 * 1000);
    expect((await questions()).map((q) => q.decision.id)).toEqual([id]);

    expect((await call(`/api/decisions/${id}/outcome`, json("POST", { status: "tried_helpful", note: "  " }))).status).toBe(400);
    expect((await call(`/api/decisions/${id}/outcome`, json("POST", { nonsense: true }))).status).toBe(400);
    const done = await call(`/api/decisions/${id}/outcome`, json("POST", { status: "tried_helpful", note: "I use it daily" }));
    expect(DecisionCardSchema.parse(await done.json())).toMatchObject({ status: "tried_helpful", outcomeNote: "I use it daily" });
    expect(await questions()).toEqual([]);
    // A second verdict is allowed: BK can change his mind.
    expect((await call(`/api/decisions/${id}/outcome`, json("POST", { status: "tried_unhelpful", note: "changed my mind" }))).status).toBe(200);
    expect((await call("/api/decisions/dec_nope/outcome", json("POST", { dismiss: true }))).status).toBe(404);
    const dismissed = await call(`/api/decisions/${id}/outcome`, json("POST", { dismiss: true }));
    expect(dismissed.status).toBe(200);
  });
});
