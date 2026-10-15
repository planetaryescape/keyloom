// The keyboard sync routes and the events stream (rung 13; src/api/http.ts lists them). startServer calls
// `handleSyncRoute` for every /api request after its Host check, and serves the Response when one comes back.
import {
  AutoSyncRequestSchema, PauseRequestSchema, SyncEventSchema, SyncNowRequestSchema, SyncNowResponseSchema, SyncStatusResponseSchema, type ApiErrorBody, type BoardSync,
} from "../api/http.ts";
import { checkToken } from "./guard.ts";
import { SyncError, type SyncBackend } from "./sync-backend.ts";

const MAX_BODY_BYTES = 10_000;
// Bun.serve drops a request that sends nothing for 10 seconds, so a quiet stream needs a comment more often than that.
export const EVENTS_HEARTBEAT_MS = 5000;

type Kind = "status" | "now" | "auto" | "pause" | "events";

function match(method: string, pathname: string): Kind | "wrong-method" | null {
  switch (pathname) {
    case "/api/sync": return method === "GET" ? "status" : method === "POST" ? "now" : "wrong-method";
    case "/api/sync/auto": return method === "POST" ? "auto" : "wrong-method";
    case "/api/sync/pause": return method === "POST" ? "pause" : "wrong-method";
    case "/api/events": return method === "GET" ? "events" : "wrong-method";
    default: return null;
  }
}

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

async function readJson(request: Request): Promise<unknown | Response> {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return errorResponse(415, "content_type", "Send this request as application/json.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return errorResponse(413, "too_large", "The request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    return errorResponse(400, "schema", "The request body is not valid JSON.");
  }
}

const frame = (boards: BoardSync[]): string => `event: sync\ndata: ${JSON.stringify(SyncEventSchema.parse({ type: "sync", boards }))}\n\n`;

function events(request: Request, backend: SyncBackend): Response {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true; // the browser went away
        }
      };
      const end = () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already cancelled
        }
      };
      // Subscribed before the snapshot is read, so a change in between is not lost; the browser takes the later frame.
      unsubscribe = backend.subscribe((boards) => send(frame(boards)));
      heartbeat = setInterval(() => send(": keepalive\n\n"), EVENTS_HEARTBEAT_MS);
      request.signal.addEventListener("abort", end, { once: true });
      void backend.status().then((boards) => send(frame(boards)), () => send(": status unavailable\n\n"));
    },
    cancel() {
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

/** Null when the request is not a sync route, so startServer carries on with its own. */
export async function handleSyncRoute(request: Request, pathname: string, backend: SyncBackend, token: string): Promise<Response | null> {
  const found = match(request.method, pathname);
  if (found === null) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  if (found === "wrong-method") return new Response("method not allowed", { status: 405 });

  try {
    if (found === "events") return events(request, backend);
    if (found === "status") return Response.json(SyncStatusResponseSchema.parse({ boards: await backend.status() }));
    const json = await readJson(request);
    if (json instanceof Response) return json;
    const bad = (issues: Array<{ path: PropertyKey[]; message: string }>) =>
      errorResponse(400, "schema", issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    if (found === "now") {
      const parsed = SyncNowRequestSchema.safeParse(json);
      if (!parsed.success) return bad(parsed.error.issues);
      return Response.json(SyncNowResponseSchema.parse(await backend.syncNow(parsed.data.layoutId)), { status: 202 });
    }
    if (found === "auto") {
      const parsed = AutoSyncRequestSchema.safeParse(json);
      if (!parsed.success) return bad(parsed.error.issues);
      return Response.json(SyncStatusResponseSchema.parse({ boards: await backend.setAutoSync(parsed.data.boardId, parsed.data.enabled) }));
    }
    const parsed = PauseRequestSchema.safeParse(json);
    if (!parsed.success) return bad(parsed.error.issues);
    return Response.json(SyncStatusResponseSchema.parse({ boards: await backend.setPaused(parsed.data.boardId, parsed.data.paused) }));
  } catch (err) {
    if (err instanceof SyncError) return errorResponse(err.status, err.code, err.message);
    console.error("keyloom: sync request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
