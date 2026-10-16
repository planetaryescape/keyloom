// The typing lab routes (src/api/lab.ts, D-314), over a real app with a scripted fake keyboard and the replay model: the guard, a whole
// session from start to read-out to delete, per-finger typos, the board that can't be recorded, and a second start refused.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { applyOps, getLayout } from "../../src/app/index.ts";
import { LabPassagesResponseSchema, LabReadoutResponseSchema, LabSessionResponseSchema, LabSessionsResponseSchema, RecordingResponseSchema } from "../../src/api/lab.ts";
import { appLabBackend } from "../../src/cli/lab-backend.ts";
import { handleLabRoute } from "../../src/server/lab-routes.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { SCRIPT, scriptedLabDeps } from "../helpers/lab-world.ts";

setDefaultTimeout(20_000);

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => servers.forEach((s) => s.stop(true)));

async function serve() {
  const { app, layoutId } = await commandShiftApp();
  // Without chordal and permissive hold, the script's S-then-D rolls fire Option, so there is something to find.
  const view = getLayout(app, layoutId);
  applyOps(app, layoutId, {
    baseRevisionId: view.revision.id, summary: "No chordal hold",
    ops: [
      { op: "removeFirmwareSetting", firmware: "qmk", key: "CHORDAL_HOLD" },
      { op: "removeFirmwareSetting", firmware: "qmk", key: "PERMISSIVE_HOLD" },
      ...view.document.holdTapProfiles.map((p) => ({ op: "upsertHoldTapProfile" as const, profile: { ...p, options: {} } })),
    ],
  });
  const backend = appLabBackend(app, scriptedLabDeps(view.board.definition, () => getLayout(app, layoutId).document, { delayMs: 5 }));
  const server = Bun.serve({ port: 0, fetch: async (r) => (await handleLabRoute(r, new URL(r.url).pathname, backend, TOKEN)) ?? new Response("no", { status: 404 }) });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), "content-type": "application/json", ...init.headers } });
  const post = (path: string, body: unknown = {}) => call(path, { method: "POST", body: JSON.stringify(body) });
  return { app, layoutId, call, post };
}

describe("the guard", () => {
  test("every route needs the token, a write needs JSON, and an unknown method is refused", async () => {
    const { layoutId, call } = await serve();
    expect((await call(`/api/lab/${layoutId}/passages`, {}, null)).status).toBe(401);
    expect((await call(`/api/lab/${layoutId}/recording`, { method: "POST", body: "x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call(`/api/lab/${layoutId}/passages`, { method: "POST", body: "{}" })).status).toBe(405);
  });
});

describe("a session through the routes", () => {
  test("passages, record, stop, analyse, read out per finger, list and delete", async () => {
    const { layoutId, call, post } = await serve();
    const passages = LabPassagesResponseSchema.parse(await (await call(`/api/lab/${layoutId}/passages`)).json());
    expect(passages.canRecord).toBe(true);
    expect(passages.passages.map((p) => p.id)).toContain("finger-drill");

    const started = await post(`/api/lab/${layoutId}/recording`, { text: SCRIPT });
    expect(started.status).toBe(201);
    RecordingResponseSchema.parse(await started.json());
    // One keyboard, one recording.
    expect((await post(`/api/lab/${layoutId}/recording`, { text: SCRIPT })).status).toBe(409);

    await new Promise((r) => setTimeout(r, 120));
    const stopped = LabSessionResponseSchema.parse(await (await post("/api/lab/recording/stop", { typedText: SCRIPT })).json());
    expect(stopped.session.eventCount).toBeGreaterThan(100);

    const before = LabReadoutResponseSchema.parse(await (await call(`/api/lab/sessions/${stopped.session.id}`)).json());
    expect(before.readout).toBeNull();

    const after = LabReadoutResponseSchema.parse(await (await post(`/api/lab/sessions/${stopped.session.id}/analyse`)).json());
    const r = after.readout;
    expect(r).not.toBeNull();
    expect(r?.counts.misfireHold).toBeGreaterThan(0);
    // Typos are counted, on the finger that pressed, and the fingers block leads with the slow ring finger.
    expect(r?.counts.typo).toBeGreaterThan(0);
    const pinky = r?.fingers.find((f) => f.finger === "left-pinky");
    expect(pinky?.typos).toBeGreaterThan(0);
    expect(r?.fingers.every((f) => f.typos + f.misfires === f.errors)).toBe(true);
    expect(r?.fingersLead).toContain("left ring is your slowest finger");
    // Every space was pressed, so nothing is missed on the thumbs.
    expect(r?.counts.missed).toBe(0);
    // A suggestion carries its proposal card, so the screen's Apply is the ordinary change set apply.
    expect(r?.suggestions.some((s) => s.proposal !== null)).toBe(true);
    // Findings name the keys to mark, never the typed text.
    expect(JSON.stringify(r)).not.toContain(SCRIPT);

    const list = LabSessionsResponseSchema.parse(await (await call(`/api/lab/${layoutId}/sessions`)).json());
    expect(list.sessions[0]?.analysed).toBe(true);
    expect((await post(`/api/lab/sessions/${stopped.session.id}/delete`)).status).toBe(200);
    expect((await call(`/api/lab/sessions/${stopped.session.id}`)).status).toBe(404);
  });

  test("stopping with nothing running is a usage error, and cancel saves nothing", async () => {
    const { layoutId, call, post } = await serve();
    expect((await post("/api/lab/recording/stop", { typedText: "x" })).status).toBe(400);
    expect((await post(`/api/lab/${layoutId}/recording`, {})).status).toBe(201);
    expect((await post("/api/lab/recording/cancel")).status).toBe(200);
    const list = LabSessionsResponseSchema.parse(await (await call(`/api/lab/${layoutId}/sessions`)).json());
    expect(list.sessions).toEqual([]);
  });
});
