import { z } from "zod";
import { AgentRunRequestSchema, AgentRunSnapshotSchema, AgentRequestCancellationSchema } from "../api/agent-runs.ts";
import { type ChatBackend, ChatError } from "./chat-backend.ts";

const answerSchema = z.object({ version: z.literal(1), requestId: z.string().min(1).max(128), answer: z.object({ toolUseId: z.string().min(1).max(128), text: z.string().trim().min(1).max(500) }) });

/** Latest-snapshot catch-up: sequences may coalesce, never replay model/tool execution. */
export async function agentRunRoute(request: Request, pathname: string, backend: ChatBackend): Promise<Response> {
  if (!pathname.startsWith("/api/agent/v1/")) throw new ChatError(400, "version", "Unsupported agent protocol. Reload or upgrade keyloom before writing.");
  const runs = backend.runs;
  if (!runs) throw new ChatError(404, "unsupported", "Durable agent runs are unavailable on this server.");
  const parts = pathname.slice("/api/agent/v1/".length).split("/");
  const [kind, rawId, verb] = parts;
  const id = rawId === undefined ? undefined : decodeURIComponent(rawId);
  if (kind === "conversations" && id && verb === "run" && request.method === "GET") return Response.json(await runs.latest(id));
  if (kind === "requests" && id && verb === "cancel" && request.method === "POST") {
    z.object({ version: z.literal(1) }).parse(await json(request));
    const requestId = z.string().min(1).max(128).refine((value) => value.trim().length > 0).parse(id);
    if (!runs.cancelRequest) throw new ChatError(404, "unsupported", "Pending request cancellation is unavailable on this server.");
    const result = AgentRequestCancellationSchema.parse(await runs.cancelRequest(requestId));
    return Response.json(result, { status: result.status === "pending_acceptance" ? 202 : 200 });
  }
  if (kind !== "runs") return new Response("not found", { status: 404 });
  if (id === undefined && request.method === "POST") {
    const input = AgentRunRequestSchema.parse(await json(request));
    return Response.json(AgentRunSnapshotSchema.parse(await runs.start(input)), { status: 202 });
  }
  if (!id) return new Response("not found", { status: 404 });
  if (verb === undefined && request.method === "GET") return Response.json(AgentRunSnapshotSchema.parse(await runs.get(id)));
  if (verb === "answer" && request.method === "POST") {
    const input = answerSchema.parse(await json(request));
    return Response.json(AgentRunSnapshotSchema.parse(await runs.answer(id, input.requestId, input.answer)), { status: 202 });
  }
  if (verb === "cancel" && request.method === "POST") {
    z.object({ version: z.literal(1) }).parse(await json(request));
    return Response.json(AgentRunSnapshotSchema.parse(await runs.cancel(id)));
  }
  if (verb === "events" && request.method === "GET") {
    const after = z.coerce.number().int().nonnegative().parse(new URL(request.url).searchParams.get("after") ?? 0);
    const initial = await runs.get(id);
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let seq = after;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (snapshot: typeof initial) => {
          if (closed) return;
          try {
            if (snapshot.seq > seq) {
              seq = snapshot.seq;
              controller.enqueue(encoder.encode(`id: ${seq}\nevent: snapshot\ndata: ${JSON.stringify(AgentRunSnapshotSchema.parse(snapshot))}\n\n`));
            }
            if (snapshot.status !== "running") { closed = true; clearInterval(timer); controller.close(); }
          } catch { closed = true; clearInterval(timer); }
        };
        write(initial);
        if (!closed) timer = setInterval(() => {
          if (!closed) { try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { closed = true; clearInterval(timer); return; } }
          void runs.get(id).then(write, () => { if (!closed) { closed = true; clearInterval(timer); controller.close(); } });
        }, 250);
      },
      cancel() { closed = true; clearInterval(timer); },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }
  return new Response("method not allowed", { status: 405 });
}

async function json(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new ChatError(400, "content_type", "Send application/json.");
  try { return await request.json(); } catch { throw new ChatError(400, "usage", "the request body is not JSON"); }
}
