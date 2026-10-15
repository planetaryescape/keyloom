// The chat panel's routes (rung 3). startServer calls `handleChatRoute` for every /api request
// after its Host check and before its own routing, and serves the Response when one comes back.
import { ChatProviderChoiceSchema, ChatProviderStatusSchema, ChatRequestSchema, ConversationDetailSchema, ConversationListResponseSchema, type ApiErrorBody, type ChatEvent } from "../api/http.ts";
import { type ChatBackend, ChatError } from "./chat-backend.ts";
import { checkToken } from "./guard.ts";

const LAYOUTS = "/api/layouts/";
const CONVERSATIONS = "/api/conversations/";
const PRIORITIES = "/api/priorities/";
const PROVIDER = "/api/chat/provider";
const HEARTBEAT_MS = 5_000;

type Match = { kind: "provider" } | { kind: "choose-provider" } | { kind: "send"; ref: string } | { kind: "list"; ref: string } | { kind: "get"; id: string } | { kind: "retire"; id: string };

function decode(raw: string): string | null {
  if (raw.length === 0 || raw.includes("/")) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}

function match(method: string, pathname: string): Match | "wrong-method" | null {
  if (pathname === PROVIDER) return method === "GET" ? { kind: "provider" } : method === "POST" ? { kind: "choose-provider" } : "wrong-method";
  if (pathname.startsWith(LAYOUTS)) {
    const parts = pathname.slice(LAYOUTS.length).split("/");
    const ref = decode(parts[0] ?? "");
    if (parts.length !== 2 || ref === null) return null;
    const verb = parts[1];
    if (verb !== "chat" && verb !== "conversations") return null;
    if (verb === "chat") return method === "POST" ? { kind: "send", ref } : "wrong-method";
    return method === "GET" ? { kind: "list", ref } : "wrong-method";
  }
  if (pathname.startsWith(CONVERSATIONS)) {
    const id = decode(pathname.slice(CONVERSATIONS.length));
    if (id === null) return null;
    return method === "GET" ? { kind: "get", id } : "wrong-method";
  }
  if (pathname.startsWith(PRIORITIES)) {
    const id = decode(pathname.slice(PRIORITIES.length));
    if (id === null) return null;
    return method === "DELETE" ? { kind: "retire", id } : "wrong-method";
  }
  return null;
}

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

const frame = (event: ChatEvent): string => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

function failure(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof ChatError) return { status: err.status, code: err.code, message: err.message };
  // The detail goes to the log; the browser gets a generic message (as startServer's respond does).
  console.error("keyloom: chat request failed", err);
  return { status: 500, code: "internal", message: "internal error" };
}

/** Null when the request is not a chat route, so startServer carries on with its own. */
export async function handleChatRoute(request: Request, pathname: string, backend: ChatBackend, token: string): Promise<Response | null> {
  const found = match(request.method, pathname);
  if (found === null) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  if (found === "wrong-method") return new Response("method not allowed", { status: 405 });

  try {
    if (found.kind === "provider") return Response.json(ChatProviderStatusSchema.parse(await backend.provider()));
    if (found.kind === "choose-provider") return await chooseProvider(request, backend);
    if (found.kind === "list") {
      const conversations = await backend.list(found.ref);
      if (conversations === null) return errorResponse(404, "not_found", `no layout "${found.ref}"`);
      return Response.json(ConversationListResponseSchema.parse({ conversations }));
    }
    if (found.kind === "retire") {
      if (!(await backend.retirePriority(found.id))) return errorResponse(404, "not_found", `no priority "${found.id}"`);
      return new Response(null, { status: 204 });
    }
    if (found.kind === "get") {
      const detail = await backend.get(found.id);
      if (detail === null) return errorResponse(404, "not_found", `no conversation "${found.id}"`);
      return Response.json(ConversationDetailSchema.parse(detail));
    }
    return await send(request, found.ref, backend);
  } catch (err) {
    const f = failure(err);
    return errorResponse(f.status, f.code, f.message);
  }
}

// The same rule as the editor's writes: JSON only, so a page on another site can't change the provider with a form.
async function chooseProvider(request: Request, backend: ChatBackend): Promise<Response> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return errorResponse(415, "content_type", "Send this request as application/json.");
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse(400, "usage", "the request body is not JSON");
  }
  const parsed = ChatProviderChoiceSchema.safeParse(json);
  if (!parsed.success) return errorResponse(400, "usage", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return Response.json(ChatProviderStatusSchema.parse(await backend.chooseProvider(parsed.data)));
}

async function send(request: Request, ref: string, backend: ChatBackend): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse(400, "usage", "the request body is not JSON");
  }
  const parsed = ChatRequestSchema.safeParse(json);
  if (!parsed.success) return errorResponse(400, "usage", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => void (controller = c),
    cancel: () => abort.abort(),
  });

  // The status line is sent with the first byte, so decide it from the first event: a turn that
  // fails before `start` is an ordinary JSON error, and one that fails later is an `error` event.
  let opened = false;
  let closed = false;
  let failed: unknown;
  let opening!: () => void;
  const firstOutcome = new Promise<void>((resolve) => void (opening = resolve));
  const write = (event: ChatEvent) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(frame(event)));
    } catch {
      closed = true; // the browser went away
    }
  };
  // Bun.serve drops a request that sends nothing for 10 seconds, and the model can think for longer
  // than that before its first token. An SSE comment every few seconds keeps the stream open and is
  // ignored by EventSource parsers (seen 2026-10-15: "request timed out after 10 seconds").
  const heartbeat = setInterval(() => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    } catch {
      closed = true;
    }
  }, HEARTBEAT_MS);
  const close = () => {
    clearInterval(heartbeat);
    if (closed) return;
    closed = true;
    try {
      controller.close();
    } catch {
      // already cancelled
    }
  };

  void backend.send(ref, parsed.data, (event) => {
    opened = true;
    write(event);
    opening();
  }, abort.signal).then(
    () => {
      if (opened) close();
      opening();
    },
    (err) => {
      failed = err;
      if (opened && !abort.signal.aborted) {
        const f = failure(err);
        write({ type: "error", code: f.code, message: f.message });
      }
      if (opened) close();
      opening();
    },
  );

  await firstOutcome;
  if (!opened) {
    clearInterval(heartbeat);
    const f = failure(failed ?? new Error("the chat backend ended without a reply"));
    return errorResponse(f.status, f.code, f.message);
  }
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
