// The new-keyboard routes (22, D-336; src/api/keyboards.ts lists them). startServer calls `handleKeyboardRoute` for every /api request
// after its Host check, and serves the Response when one comes back.
import type { z } from "zod";
import type { ApiErrorBody } from "../api/http.ts";
import {
  AddRequestSchema, AddResponseSchema, DetectResponseSchema, PreviewRequestSchema, PreviewResponseSchema, PutPreviewResponseSchema, PutRequestSchema, PutResponseSchema,
} from "../api/keyboards.ts";
import { checkToken } from "./guard.ts";
import { KeyboardsError, type KeyboardsBackend } from "./keyboards-backend.ts";

const MAX_BODY_BYTES = 10_000;

const errorResponse = (status: number, code: string, message: string): Response => Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

type Action = "detect" | "preview" | "add" | "putPreview" | "put";
const ROUTES: Record<string, { method: "GET" | "POST"; action: Action }> = {
  "/api/keyboards/detect": { method: "GET", action: "detect" },
  "/api/keyboards/preview": { method: "POST", action: "preview" },
  "/api/keyboards/add": { method: "POST", action: "add" },
  "/api/keyboards/put/preview": { method: "POST", action: "putPreview" },
  "/api/keyboards/put": { method: "POST", action: "put" },
};

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

/** Null when the request is not a keyboards route, so startServer carries on with its own. */
export async function handleKeyboardRoute(request: Request, pathname: string, backend: KeyboardsBackend, token: string): Promise<Response | null> {
  if (!pathname.startsWith("/api/keyboards")) return null;
  const route = ROUTES[pathname];
  if (route === undefined) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  if (request.method !== route.method) return new Response("method not allowed", { status: 405 });
  try {
    if (route.action === "detect") {
      const search = new URL(request.url).searchParams.get("search");
      return Response.json(DetectResponseSchema.parse(await backend.detect(search === null || search.trim() === "" ? null : search.trim())));
    }
    if (route.action === "preview") {
      const body = await readBody(request, PreviewRequestSchema);
      if (body instanceof Response) return body;
      return Response.json(PreviewResponseSchema.parse(await backend.preview(body)));
    }
    if (route.action === "add") {
      const body = await readBody(request, AddRequestSchema);
      if (body instanceof Response) return body;
      return Response.json(AddResponseSchema.parse(await backend.add(body)), { status: 201 });
    }
    const body = await readBody(request, PutRequestSchema);
    if (body instanceof Response) return body;
    if (route.action === "putPreview") return Response.json(PutPreviewResponseSchema.parse(await backend.previewPut(body)));
    return Response.json(PutResponseSchema.parse(await backend.put(body)), { status: 201 });
  } catch (err) {
    if (err instanceof KeyboardsError) return errorResponse(err.status, err.code, err.message);
    console.error("keyloom: keyboards request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
