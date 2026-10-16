// The configs and versions routes (rung 23; src/api/configs.ts lists them). startServer calls `handleConfigRoute` for every /api
// request after its Host check, and serves the Response when one comes back.
import { z } from "zod";
import {
  CompareResponseSchema, ConfigListResponseSchema, ConfigResponseSchema, DeleteConfigRequestSchema, NameVersionRequestSchema, NameVersionResponseSchema, NewConfigRequestSchema,
  ProposalsResponseSchema, RenameConfigRequestSchema, RestoreVersionRequestSchema, RestoreVersionResponseSchema, VersionHistoryResponseSchema,
} from "../api/configs.ts";
import { SyncNowResponseSchema, type ApiErrorBody } from "../api/http.ts";
import { ConfigsError, type ConfigsBackend } from "./configs-backend.ts";
import { checkToken } from "./guard.ts";

const MAX_BODY_BYTES = 10_000;
const EmptyBody = z.object({}).strict();

const errorResponse = (status: number, code: string, message: string, validation?: ApiErrorBody["validation"]): Response =>
  Response.json({ error: { code, message }, ...(validation === undefined ? {} : { validation }) } satisfies ApiErrorBody, { status });

type Action = "list" | "create" | "rename" | "archive" | "restore" | "delete" | "use" | "versions" | "name" | "restoreVersion" | "compare" | "proposals";
const ROUTES: ReadonlyArray<{ method: "GET" | "POST"; shape: string; action: Action }> = [
  { method: "GET", shape: "configs", action: "list" },
  { method: "POST", shape: "configs", action: "create" },
  { method: "POST", shape: "configs/:/rename", action: "rename" },
  { method: "POST", shape: "configs/:/archive", action: "archive" },
  { method: "POST", shape: "configs/:/restore", action: "restore" },
  { method: "POST", shape: "configs/:/delete", action: "delete" },
  { method: "POST", shape: "configs/:/use", action: "use" },
  { method: "GET", shape: "configs/:/versions", action: "versions" },
  { method: "POST", shape: "configs/:/versions/name", action: "name" },
  { method: "POST", shape: "configs/:/versions/restore", action: "restoreVersion" },
  { method: "GET", shape: "configs/:/compare", action: "compare" },
  { method: "GET", shape: "configs/:/proposals", action: "proposals" },
];

/** The route a path names, with its one captured segment URL-decoded; "wrong-method" when only the method is off. */
function match(method: string, pathname: string): { action: Action; ref: string } | "wrong-method" | null {
  if (!pathname.startsWith("/api/configs")) return null;
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

/** Null when the request is not a configs route, so startServer carries on with its own. */
export async function handleConfigRoute(request: Request, pathname: string, backend: ConfigsBackend, token: string): Promise<Response | null> {
  const found = match(request.method, pathname);
  if (found === null) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  if (found === "wrong-method") return new Response("method not allowed", { status: 405 });
  const { action, ref } = found;

  try {
    if (action === "list") {
      const query = new URL(request.url).searchParams;
      const board = query.get("board");
      const configs = await backend.list({ ...(board ? { board } : {}), includeArchived: query.get("archived") === "1" });
      return Response.json(ConfigListResponseSchema.parse({ configs }));
    }
    if (action === "versions") return Response.json(VersionHistoryResponseSchema.parse(await backend.versions(ref)));
    if (action === "proposals") return Response.json(ProposalsResponseSchema.parse({ proposals: await backend.proposals(ref) }));
    if (action === "compare") {
      const to = new URL(request.url).searchParams.get("to");
      if (!to) return errorResponse(400, "schema", "Name the revision or version to compare: ?to=...");
      return Response.json(CompareResponseSchema.parse(await backend.compare(ref, to)));
    }

    if (action === "create") {
      const body = await readBody(request, NewConfigRequestSchema);
      if (body instanceof Response) return body;
      return Response.json(ConfigResponseSchema.parse({ config: await backend.create(body) }), { status: 201 });
    }
    if (action === "rename") {
      const body = await readBody(request, RenameConfigRequestSchema);
      if (body instanceof Response) return body;
      return Response.json(ConfigResponseSchema.parse({ config: await backend.rename(ref, body.name) }));
    }
    if (action === "delete") {
      const body = await readBody(request, DeleteConfigRequestSchema);
      if (body instanceof Response) return body;
      await backend.remove(ref, body.name);
      return Response.json({});
    }
    if (action === "name") {
      const body = await readBody(request, NameVersionRequestSchema);
      if (body instanceof Response) return body;
      return Response.json(NameVersionResponseSchema.parse({ version: await backend.nameVersion(ref, body.target, body.name) }));
    }
    if (action === "restoreVersion") {
      const body = await readBody(request, RestoreVersionRequestSchema);
      if (body instanceof Response) return body;
      return Response.json(RestoreVersionResponseSchema.parse(await backend.restoreVersion(ref, body.target)));
    }
    // archive, restore and use take no body; reading `{}` keeps the content-type rule the same on every POST.
    const empty = await readBody(request, EmptyBody);
    if (empty instanceof Response) return empty;
    if (action === "use") return Response.json(SyncNowResponseSchema.parse(await backend.use(ref)), { status: 202 });
    const config = action === "archive" ? await backend.archive(ref) : await backend.restore(ref);
    return Response.json(ConfigResponseSchema.parse({ config }));
  } catch (err) {
    if (err instanceof ConfigsError) return errorResponse(err.status, err.code, err.message, err.validation);
    console.error("keyloom: configs request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
