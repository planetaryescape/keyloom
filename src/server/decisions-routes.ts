// The decisions routes (rung 6; src/api/http.ts lists them). startServer calls `handleDecisionRoute`
// for every /api request after its Host check, and serves the Response when one comes back.
import {
  DecisionCardSchema, DecisionListResponseSchema, DecisionPatchSchema, OutcomeAnswerSchema, OutcomeQuestionsResponseSchema, type ApiErrorBody,
} from "../api/http.ts";
import { DecisionError, type DecisionsBackend } from "./decisions-backend.ts";
import { checkToken } from "./guard.ts";

const LAYOUTS = "/api/layouts/";
const DECISIONS = "/api/decisions/";
const MAX_BODY_BYTES = 100_000;

type Match =
  | { kind: "list"; ref: string }
  | { kind: "questions"; ref: string }
  | { kind: "update"; id: string }
  | { kind: "retire"; id: string }
  | { kind: "answer"; id: string };

function decode(raw: string): string | null {
  if (raw.length === 0 || raw.includes("/")) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}

function match(method: string, pathname: string): Match | "wrong-method" | null {
  if (pathname.startsWith(LAYOUTS)) {
    const parts = pathname.slice(LAYOUTS.length).split("/");
    const ref = decode(parts[0] ?? "");
    if (parts.length !== 2 || ref === null) return null;
    if (parts[1] === "decisions") return method === "GET" ? { kind: "list", ref } : "wrong-method";
    if (parts[1] === "outcome-questions") return method === "GET" ? { kind: "questions", ref } : "wrong-method";
    return null;
  }
  if (pathname.startsWith(DECISIONS)) {
    const parts = pathname.slice(DECISIONS.length).split("/");
    const id = decode(parts[0] ?? "");
    if (id === null) return null;
    if (parts.length === 1) {
      if (method === "PATCH") return { kind: "update", id };
      return method === "DELETE" ? { kind: "retire", id } : "wrong-method";
    }
    if (parts.length === 2 && parts[1] === "outcome") return method === "POST" ? { kind: "answer", id } : "wrong-method";
  }
  return null;
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

/** Null when the request is not a decisions route, so startServer carries on with its own. */
export async function handleDecisionRoute(request: Request, pathname: string, backend: DecisionsBackend, token: string): Promise<Response | null> {
  const found = match(request.method, pathname);
  if (found === null) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  if (found === "wrong-method") return new Response("method not allowed", { status: 405 });

  try {
    if (found.kind === "list") {
      const decisions = await backend.list(found.ref);
      return decisions === null ? errorResponse(404, "not_found", `no layout "${found.ref}"`) : Response.json(DecisionListResponseSchema.parse({ decisions }));
    }
    if (found.kind === "questions") {
      const questions = await backend.questions(found.ref);
      return questions === null ? errorResponse(404, "not_found", `no layout "${found.ref}"`) : Response.json(OutcomeQuestionsResponseSchema.parse({ questions }));
    }
    if (found.kind === "retire") {
      return (await backend.retire(found.id)) ? new Response(null, { status: 204 }) : errorResponse(404, "not_found", `no decision "${found.id}"`);
    }
    const json = await readJson(request);
    if (json instanceof Response) return json;
    if (found.kind === "update") {
      const parsed = DecisionPatchSchema.safeParse(json);
      if (!parsed.success) return errorResponse(400, "schema", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
      return Response.json(DecisionCardSchema.parse(await backend.update(found.id, parsed.data)));
    }
    const parsed = OutcomeAnswerSchema.safeParse(json);
    if (!parsed.success) return errorResponse(400, "schema", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    return Response.json(DecisionCardSchema.parse(await backend.answer(found.id, parsed.data)));
  } catch (err) {
    if (err instanceof DecisionError) return errorResponse(err.status, err.code, err.message);
    console.error("keyloom: decisions request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
