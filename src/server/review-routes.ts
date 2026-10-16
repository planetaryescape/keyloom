// The board review routes (D-340; src/api/review.ts lists them). startServer calls `handleReviewRoute` for every /api request after its
// Host check, and serves the Response when one comes back.
import { z } from "zod";
import type { ApiErrorBody } from "../api/http.ts";
import { ReviewResponseSchema, RunReviewRequestSchema } from "../api/review.ts";
import { checkToken } from "./guard.ts";
import { ReviewError, type ReviewBackend } from "./review-backend.ts";

const MAX_BODY_BYTES = 10_000;
const EmptyBody = z.object({}).strict();

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

type Action = "show" | "run" | "dismiss" | "restore";

/** The route a path names, with the config and item segments URL-decoded; "wrong-method" when only the method is off. */
function match(method: string, pathname: string): { action: Action; ref: string; itemId?: string } | "wrong-method" | null {
  const segments = pathname.split("/");
  // ["", "api", "layouts", ref, "review", ...]
  if (segments.length < 5 || segments[1] !== "api" || segments[2] !== "layouts" || segments[4] !== "review") return null;
  const decode = (s: string | undefined): string | null => {
    try {
      const text = decodeURIComponent(s ?? "");
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  };
  const ref = decode(segments[3]);
  if (ref === null) return null;
  const rest = segments.slice(5);
  if (rest.length === 0) return method === "GET" ? { action: "show", ref } : "wrong-method";
  if (rest.length === 1 && rest[0] === "run") return method === "POST" ? { action: "run", ref } : "wrong-method";
  if (rest.length === 3 && rest[0] === "items" && (rest[2] === "dismiss" || rest[2] === "restore")) {
    const itemId = decode(rest[1]);
    if (itemId === null) return null;
    return method === "POST" ? { action: rest[2], ref, itemId } : "wrong-method";
  }
  return null;
}

async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | Response> {
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

/** Null when the request is not a review route, so startServer carries on with its own. */
export async function handleReviewRoute(request: Request, pathname: string, backend: ReviewBackend, token: string): Promise<Response | null> {
  const found = match(request.method, pathname);
  if (found === null) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  if (found === "wrong-method") return new Response("method not allowed", { status: 405 });
  const { action, ref, itemId } = found;

  try {
    if (action === "show") return Response.json(ReviewResponseSchema.parse(await backend.show(ref)));
    if (action === "run") {
      const body = await readBody(request, RunReviewRequestSchema);
      if (body instanceof Response) return body;
      return Response.json(ReviewResponseSchema.parse(await backend.run(ref, { force: body.force === true })), { status: 202 });
    }
    // dismiss and restore take no body; reading `{}` keeps the content-type rule the same on every POST.
    const empty = await readBody(request, EmptyBody);
    if (empty instanceof Response) return empty;
    const view = action === "dismiss" ? await backend.dismiss(ref, itemId as string) : await backend.restore(ref, itemId as string);
    return Response.json(ReviewResponseSchema.parse(view));
  } catch (err) {
    if (err instanceof ReviewError) return errorResponse(err.status, err.code, err.message);
    console.error("keyloom: review request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
