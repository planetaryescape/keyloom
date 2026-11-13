// The typing lab routes (src/api/lab.ts, D-314), over a real app with a scripted fake keyboard and the replay model: the guard, a whole
// session from start to read-out to delete, per-finger typos, the board that can't be recorded, and a second start refused.
import { afterAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { EmulateFailedError, applyOps, getLayout, type LabDeps } from "../../src/app/index.ts";
import { LabPassagesResponseSchema, LabReadoutResponseSchema, LabSessionResponseSchema, LabSessionsResponseSchema, RecordingResponseSchema } from "../../src/api/lab.ts";
import { appLabBackend } from "../../src/cli/lab-backend.ts";
import { handleLabRoute } from "../../src/server/lab-routes.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { SCRIPT, scriptedLabDeps } from "../helpers/lab-world.ts";
import { modelReplay } from "../helpers/typing-lab.ts";

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
    // A whole recording says so, so the page offers it as a row to open (R4-14).
    expect(list.sessions[0]?.incomplete).toBe(false);
    expect((await post(`/api/lab/sessions/${stopped.session.id}/delete`)).status).toBe(200);
    expect((await call(`/api/lab/sessions/${stopped.session.id}`)).status).toBe(404);
  });

  test("stopping with nothing running is refused with its own code, and cancel saves nothing", async () => {
    const { layoutId, call, post } = await serve();
    const stopped = await post("/api/lab/recording/stop", { typedText: "x" });
    expect(stopped.status).toBe(409);
    expect((await stopped.json()).error.code).toBe("not_recording");
    expect((await post("/api/lab/recording/cancel")).status).toBe(200);
    expect((await post("/api/lab/recording/cancel")).status).toBe(200);
    expect((await post(`/api/lab/${layoutId}/recording`, {})).status).toBe(201);
    expect((await post("/api/lab/recording/cancel")).status).toBe(200);
    expect((await post(`/api/lab/${layoutId}/recording`, {})).status).toBe(201);
    expect((await post("/api/lab/recording/cancel")).status).toBe(200);
    const list = LabSessionsResponseSchema.parse(await (await call(`/api/lab/${layoutId}/sessions`)).json());
    expect(list.sessions).toEqual([]);
  });
});

test("a start during route cancellation is refused, and a later start succeeds", async () => {
  const { app, layoutId } = await commandShiftApp();
  const finish = Promise.withResolvers<{ events: []; warnings: []; endedBy: string }>();
  const finishCalled = Promise.withResolvers<void>();
  const deps: LabDeps = {
    startCapture: async () => ({ snapshot: () => [], ended: new Promise(() => {}), finish: () => { finishCalled.resolve(); return finish.promise; } }),
    replay: () => modelReplay(getLayout(app, layoutId).board.definition),
  };
  const backend = appLabBackend(app, deps);
  const server = Bun.serve({ port: 0, fetch: async (r) => (await handleLabRoute(r, new URL(r.url).pathname, backend, TOKEN)) ?? new Response("no", { status: 404 }) });
  servers.push(server);
  const post = (path: string, body: unknown = {}) => fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: "POST", headers: { "x-keyloom-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    expect((await post(`/api/lab/${layoutId}/recording`)).status).toBe(201);
    const cancelling = post("/api/lab/recording/cancel");
    await finishCalled.promise;
    expect((await post(`/api/lab/${layoutId}/recording`)).status).toBe(409);
    finish.resolve({ events: [], warnings: [], endedBy: "host" });
    expect((await cancelling).status).toBe(200);
    expect((await post(`/api/lab/${layoutId}/recording`)).status).toBe(201);
    expect((await post("/api/lab/recording/cancel")).status).toBe(200);
  } finally {
    finish.resolve({ events: [], warnings: [], endedBy: "host" });
    app.db.close();
  }
});

test("shutdown waits for an in-flight stop to persist its session", async () => {
  const { app, layoutId } = await commandShiftApp();
  const finish = Promise.withResolvers<{ events: [{ at: number; position: number; action: "press" }]; warnings: []; endedBy: string }>();
  const deps: LabDeps = {
    startCapture: async () => ({ snapshot: () => [], ended: new Promise(() => {}), finish: () => finish.promise }),
    replay: () => modelReplay(getLayout(app, layoutId).board.definition),
  };
  let stopping: Promise<unknown> | undefined;
  let cancelling: Promise<void> | undefined;
  try {
    const backend = appLabBackend(app, deps);
    await backend.start(layoutId, {});
    stopping = backend.stop("x");
    let cancelSettled = false;
    cancelling = backend.cancel().then(() => { cancelSettled = true; });
    await Bun.sleep(10);
    expect(cancelSettled).toBe(false);
    finish.resolve({ events: [{ at: 0, position: 1, action: "press" }], warnings: [], endedBy: "host" });
    await Promise.all([stopping, cancelling]);
    expect((await backend.sessions(layoutId))).toHaveLength(1);
  } finally {
    finish.resolve({ events: [{ at: 0, position: 1, action: "press" }], warnings: [], endedBy: "host" });
    await Promise.allSettled([stopping, cancelling]);
    app.db.close();
  }
});

test("a keyboard whose firmware can't stream yet is refused with needs_sync, which the lab turns into Sync now (R1-19)", async () => {
  const { app, layoutId } = await commandShiftApp();
  const { CaptureError } = await import("../../src/firmware/emulate/trace.ts");
  const deps: LabDeps = {
    startCapture: async () => { throw new CaptureError("the connected ZSA keyboard isn't running a keyloom build", { code: "needs_sync" }); },
    replay: () => modelReplay(getLayout(app, layoutId).board.definition),
  };
  try {
    await expect(appLabBackend(app, deps).start(layoutId, {})).rejects.toMatchObject({ status: 400, code: "needs_sync" });
  } finally {
    app.db.close();
  }
});

test("firmware keyloom didn't build is refused with foreign_firmware, which the lab turns into Build and flash only (R1-19)", async () => {
  const { app, layoutId } = await commandShiftApp();
  const { findQmkStreamDevice } = await import("../../src/firmware/qmk/typing-capture.ts");
  // An Oryx build: a ZSA keyboard with no keyloom marker in its serial.
  const oryx = { list: async () => [{ vendorId: 0x3297, productId: 0x1969, serial: "QxKPz/zLQ3Md", handle: "synthetic-only" }], write: async () => {} };
  const deps: LabDeps = {
    startCapture: async () => { await findQmkStreamDevice(oryx); throw new Error("unreachable"); },
    replay: () => modelReplay(getLayout(app, layoutId).board.definition),
  };
  try {
    await expect(appLabBackend(app, deps).start(layoutId, {})).rejects.toMatchObject({ status: 400, code: "foreign_firmware" });
  } finally {
    app.db.close();
  }
});

test("shutdown waits for a pending start and finishes the capture it acquires", async () => {
  const { app, layoutId } = await commandShiftApp();
  const started = Promise.withResolvers<ReturnType<LabDeps["startCapture"]> extends Promise<infer T> ? T : never>();
  const finish = Promise.withResolvers<{ events: []; warnings: []; endedBy: string }>();
  const capture = { snapshot: () => [], ended: new Promise<string>(() => {}), finish: () => finish.promise };
  const deps: LabDeps = {
    startCapture: () => started.promise,
    replay: () => modelReplay(getLayout(app, layoutId).board.definition),
  };
  let starting: Promise<unknown> | undefined;
  let cancelling: Promise<void> | undefined;
  try {
    const backend = appLabBackend(app, deps);
    starting = backend.start(layoutId, {});
    await expect(backend.start(layoutId, {})).rejects.toMatchObject({ status: 409, code: "recording_running" });
    let cancelSettled = false;
    cancelling = backend.cancel().then(() => { cancelSettled = true; });
    await Bun.sleep(10);
    expect(cancelSettled).toBe(false);
    started.resolve(capture);
    await Bun.sleep(10);
    expect(cancelSettled).toBe(false);
    finish.resolve({ events: [], warnings: [], endedBy: "host" });
    await Promise.all([starting, cancelling]);
    expect(cancelSettled).toBe(true);
    expect(await backend.sessions(layoutId)).toEqual([]);
  } finally {
    started.resolve(capture);
    finish.resolve({ events: [], warnings: [], endedBy: "host" });
    await Promise.allSettled([starting, cancelling]);
    app.db.close();
  }
});

describe("a read-out that can't replay (R6-02)", () => {
  async function failingReplay(error: Error) {
    const { app, layoutId } = await commandShiftApp();
    const view = getLayout(app, layoutId);
    const scripted = scriptedLabDeps(view.board.definition, () => getLayout(app, layoutId).document, { delayMs: 5 });
    const backend = appLabBackend(app, { ...scripted, replay: () => async () => { throw error; } });
    const server = Bun.serve({ port: 0, fetch: async (r) => (await handleLabRoute(r, new URL(r.url).pathname, backend, TOKEN)) ?? new Response("no", { status: 404 }) });
    servers.push(server);
    const post = (path: string, body: unknown = {}) => fetch(`http://127.0.0.1:${server.port}${path}`, {
      method: "POST", headers: { "x-keyloom-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect((await post(`/api/lab/${layoutId}/recording`, { text: SCRIPT })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 120));
    const stopped = LabSessionResponseSchema.parse(await (await post("/api/lab/recording/stop", { typedText: SCRIPT })).json());
    return post(`/api/lab/sessions/${stopped.session.id}/analyse`);
  }

  test("Docker that stopped the replay is its own code, in words, with no log path", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await failingReplay(new EmulateFailedError("Docker is not on this computer. (log: /tmp/x.log)", "/tmp/x.log", "docker_unavailable"));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "docker_unavailable", message: "Docker isn't ready, so the recording couldn't be played back." } });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("/tmp/x.log"));
    } finally { log.mockRestore(); }
  });

  test("any other replay failure is replay_failed in keyloom's words: no directory and no key-log line reach the page", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      // The ZMK emulator's message ends with the firmware's last output lines, which after the run marker are the recording's keycodes.
      const raw = "the emulator stopped in /Users/x/.keyloom/checkouts/zmk: keycode 0x04 pressed\nkeycode 0x04 released (log: /tmp/y.log)";
      const response = await failingReplay(new EmulateFailedError(raw, "/tmp/y.log"));
      expect(response.status).toBe(500);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body).toEqual({ error: { code: "replay_failed", message: "The firmware replay stopped with an error. The details are in keyloom's log." } });
      expect(JSON.stringify(body)).not.toMatch(/keycode|\/Users|\/tmp/);
      // The server's log keeps the whole message, for whoever looks into it.
      expect(log).toHaveBeenCalledWith(expect.stringContaining("keycode 0x04 pressed"));
    } finally { log.mockRestore(); }
  });
});
