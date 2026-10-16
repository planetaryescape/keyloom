// The typing lab routes (src/api/lab.ts lists them). startServer calls `handleLabRoute` for every /api request after its Host
// check, and serves the Response when one comes back.
import { z } from "zod";
import {
  LabPassagesResponseSchema, LabReadoutResponseSchema, LabSessionResponseSchema, LabSessionsResponseSchema, RecordingResponseSchema, StartRecordingRequestSchema,
  StopRecordingRequestSchema,
} from "../api/lab.ts";
import type { ApiErrorBody } from "../api/http.ts";
import { checkToken } from "./guard.ts";
import { LabError, type LabBackend } from "./lab-backend.ts";

const MAX_BODY_BYTES = 60_000;
const EmptyBody = z.object({}).strict();

const errorResponse = (status: number, code: string, message: string): Response => Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

type Action = "passages" | "sessions" | "start" | "stop" | "cancel" | "readout" | "analyse" | "delete";
const ROUTES: ReadonlyArray<{ method: "GET" | "POST"; shape: string; action: Action }> = [
  { method: "POST", shape: "lab/recording/stop", action: "stop" },
  { method: "POST", shape: "lab/recording/cancel", action: "cancel" },
  { method: "GET", shape: "lab/sessions/:", action: "readout" },
  { method: "POST", shape: "lab/sessions/:/analyse", action: "analyse" },
  { method: "POST", shape: "lab/sessions/:/delete", action: "delete" },
  { method: "GET", shape: "lab/:/passages", action: "passages" },
  { method: "GET", shape: "lab/:/sessions", action: "sessions" },
  { method: "POST", shape: "lab/:/recording", action: "start" },
];

function match(method: string, pathname: string): { action: Action; ref: string } | "wrong-method" | null {
  if (!pathname.startsWith("/api/lab/")) return null;
  const segments = pathname.slice("/api/".length).split("/");
  let pathMatched = false;
  for (const route of ROUTES) {
    const expected = route.shape.split("/");
    if (expected.length !== segments.length) continue;
    let ref = "";
    let ok = true;
    for (const [i, part] of expected.entries()) {
      const segment = segments[i] as string;
      if (part === ":") {
        try {
          ref = decodeURIComponent(segment);
        } catch {
          return null;
        }
        if (ref.length === 0) return null;
      } else if (part !== segment) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (route.method === method) return { action: route.action, ref };
  }
  return pathMatched ? "wrong-method" : null;
}

async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return errorResponse(415, "content_type", "Send this request as application/json.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return errorResponse(413, "too_large", "The request body is too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return errorResponse(400, "schema", "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return errorResponse(400, "schema", `The request body is not valid${first && first.path.length > 0 ? ` at ${first.path.join(".")}` : ""}: ${first?.message ?? "unknown problem"}.`);
  }
  return parsed.data;
}

/** Null when the request is not a lab route. */
export async function handleLabRoute(request: Request, pathname: string, backend: LabBackend, token: string): Promise<Response | null> {
  const found = match(request.method, pathname);
  if (found === null) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  if (found === "wrong-method") return new Response("method not allowed", { status: 405 });
  const { action, ref } = found;
  try {
    if (action === "passages") return Response.json(LabPassagesResponseSchema.parse(await backend.passages(ref)));
    if (action === "sessions") return Response.json(LabSessionsResponseSchema.parse({ sessions: await backend.sessions(ref) }));
    if (action === "readout") return Response.json(LabReadoutResponseSchema.parse(await backend.readout(ref)));
    if (action === "start") {
      const body = await readBody(request, StartRecordingRequestSchema);
      if (body instanceof Response) return body;
      return Response.json(RecordingResponseSchema.parse({ recording: await backend.start(ref, body) }), { status: 201 });
    }
    if (action === "stop") {
      const body = await readBody(request, StopRecordingRequestSchema);
      if (body instanceof Response) return body;
      return Response.json(LabSessionResponseSchema.parse({ session: await backend.stop(body.typedText) }));
    }
    const empty = await readBody(request, EmptyBody);
    if (empty instanceof Response) return empty;
    if (action === "cancel") {
      await backend.cancel();
      return Response.json({});
    }
    if (action === "analyse") return Response.json(LabReadoutResponseSchema.parse(await backend.analyse(ref)));
    await backend.remove(ref);
    return Response.json({});
  } catch (err) {
    if (err instanceof LabError) return errorResponse(err.status, err.code, err.message);
    console.error("keyloom: lab request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
