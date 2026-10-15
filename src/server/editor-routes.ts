// The rung 2 write routes (src/api/http.ts lists them). The caller has already passed the Host and
// token checks, so this module only decides method, body and the backend call.
import { z } from "zod";
import {
  ApplyRequestSchema,
  ApplyResponseSchema,
  BoardListResponseSchema,
  BuildRequestSchema,
  BuildSchema,
  CheckRequestSchema,
  CheckResponseSchema,
  FlashSchema,
  ImportResponseSchema,
  ParseBindingRequestSchema,
  ParseBindingResponseSchema,
  RevisionListResponseSchema,
  UndoRequestSchema,
  UndoResponseSchema,
  type ApiErrorBody,
} from "../api/http.ts";
import { EditorError, type EditorBackend } from "./editor-backend.ts";

// The most any request body may carry. Change sets are small; this stops a runaway client
// before the body is read into memory.
export const MAX_BODY_BYTES = 1_000_000;

// An uploaded export is a zip of a few hundred kB at most; the cap only stops a runaway upload.
export const MAX_IMPORT_BYTES = 8_000_000;

const EmptyBody = z.object({}).strict();

type Method = "GET" | "POST";
type Route = {
  method: Method;
  run: (backend: EditorBackend, id: string, request: Request) => Promise<Response>;
};

// Route patterns over the path segments after /api. The one `:` segment is captured, URL-decoded.
const ROUTES: readonly (readonly [pattern: string, route: Route])[] = [
  ["layouts/:/check", { method: "POST", run: (b, ref, r) => check(b, ref, r) }],
  ["layouts/:/parse-binding", { method: "POST", run: (b, ref, r) => parseBinding(b, ref, r) }],
  ["layouts/:/apply", { method: "POST", run: (b, ref, r) => apply(b, ref, r) }],
  ["change-sets/:/apply", { method: "POST", run: (b, id, r) => applyChangeSet(b, id, r) }],
  ["layouts/:/undo", { method: "POST", run: (b, ref, r) => undo(b, ref, r) }],
  ["layouts/:/revisions", { method: "GET", run: async (b, ref) => Response.json(RevisionListResponseSchema.parse({ revisions: await b.revisions(ref) })) }],
  ["boards", { method: "GET", run: async (b) => Response.json(BoardListResponseSchema.parse({ boards: await b.boards() })) }],
  ["import", { method: "POST", run: (b, _id, r) => importUpload(b, r) }],
  ["layouts/:/builds", { method: "POST", run: (b, ref, r) => startBuild(b, ref, r) }],
  ["builds/:", { method: "GET", run: (b, id) => found(b.getBuild(id), BuildSchema, "build") }],
  ["builds/:/flashes", { method: "POST", run: (b, id, r) => startFlash(b, id, r) }],
  ["flashes/:", { method: "GET", run: (b, id) => found(b.getFlash(id), FlashSchema, "flash") }],
];

/** True for paths only the editor serves, so a server without a backend can answer 404 for them. */
export function isEditorPath(pathname: string): boolean {
  return matchRoute(pathname) !== null;
}

/**
 * Handles a request for an editor route, or returns null when the path is not one.
 * A known path with the wrong method is 405, so the browser can tell a typo from a missing feature.
 */
export async function handleEditorRoute(
  request: Request,
  pathname: string,
  backend: EditorBackend,
): Promise<Response | null> {
  const matched = matchRoute(pathname);
  if (matched === null) return null;
  const { route, id } = matched;
  if (request.method !== route.method) {
    return new Response("method not allowed", { status: 405, headers: { allow: route.method } });
  }
  try {
    return await route.run(backend, id, request);
  } catch (error) {
    if (error instanceof EditorError) return fail(error.status, error.code, error.message, error.validation);
    throw error;
  }
}

function matchRoute(pathname: string): { route: Route; id: string } | null {
  if (!pathname.startsWith("/api/")) return null;
  const segments = pathname.slice("/api/".length).split("/");
  for (const [pattern, route] of ROUTES) {
    const expected = pattern.split("/");
    if (expected.length !== segments.length) continue;
    let id = "";
    let matches = true;
    for (const [index, part] of expected.entries()) {
      const segment = segments[index] as string;
      if (part === ":") {
        const decoded = decode(segment);
        if (decoded === null) return null;
        id = decoded;
      } else if (part !== segment) {
        matches = false;
        break;
      }
    }
    if (matches) return { route, id };
  }
  return null;
}

// A malformed escape is a 404 for the route, not a 500: the client built the URL from known ids.
function decode(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function fail(status: number, code: string, message: string, validation?: ApiErrorBody["validation"]): Response {
  const body: ApiErrorBody = { error: { code, message }, ...(validation === undefined ? {} : { validation }) };
  return Response.json(body, { status });
}

// Requiring application/json keeps every write a request a plain HTML form can't send, on top of
// the token header (which already forces a CORS preflight that the server never answers).
async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    return fail(415, "content_type", "Send this request as application/json.");
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return fail(413, "too_large", "The request body is too large.");
  let json: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return fail(413, "too_large", "The request body is too large.");
    json = JSON.parse(text);
  } catch {
    return fail(400, "schema", "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined || first.path.length === 0 ? "" : ` at ${first.path.join(".")}`;
    return fail(400, "schema", `The request body is not valid${where}: ${first?.message ?? "unknown problem"}.`);
  }
  return parsed.data;
}

async function check(backend: EditorBackend, ref: string, request: Request): Promise<Response> {
  const body = await readBody(request, CheckRequestSchema);
  if (body instanceof Response) return body;
  const validation = await backend.check(ref, body);
  return Response.json(CheckResponseSchema.parse({ validation }));
}

async function parseBinding(backend: EditorBackend, ref: string, request: Request): Promise<Response> {
  const body = await readBody(request, ParseBindingRequestSchema);
  if (body instanceof Response) return body;
  return Response.json(ParseBindingResponseSchema.parse(await backend.parseBinding(ref, body)));
}

async function apply(backend: EditorBackend, ref: string, request: Request): Promise<Response> {
  const body = await readBody(request, ApplyRequestSchema);
  if (body instanceof Response) return body;
  return Response.json(ApplyResponseSchema.parse(await backend.apply(ref, body)));
}

// The body is `{}`, like a flash's: the change set is already stored, so the request carries nothing else.
async function applyChangeSet(backend: EditorBackend, changeSetId: string, request: Request): Promise<Response> {
  const body = await readBody(request, EmptyBody);
  if (body instanceof Response) return body;
  return Response.json(ApplyResponseSchema.parse(await backend.applyChangeSet(changeSetId)));
}

async function undo(backend: EditorBackend, ref: string, request: Request): Promise<Response> {
  const body = await readBody(request, UndoRequestSchema);
  if (body instanceof Response) return body;
  return Response.json(UndoResponseSchema.parse(await backend.undo(ref, body)));
}

// The file is the request body, not a form field: application/octet-stream can't be sent by a plain HTML form,
// which keeps this write as closed to other sites as the JSON ones. Everything else rides in the query.
async function importUpload(backend: EditorBackend, request: Request): Promise<Response> {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/octet-stream") return fail(415, "content_type", "Send the file as application/octet-stream.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMPORT_BYTES) return fail(413, "too_large", "That file is too large to be a layout export.");
  const query = new URL(request.url).searchParams;
  const board = query.get("board");
  const filename = query.get("filename");
  const name = query.get("name")?.trim();
  if (!board || !filename) return fail(400, "schema", "Name the board and the file: ?board=...&filename=...");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_IMPORT_BYTES) return fail(413, "too_large", "That file is too large to be a layout export.");
  return Response.json(ImportResponseSchema.parse(await backend.importUpload({ board, filename, bytes, ...(name ? { name } : {}) })), { status: 201 });
}

async function startBuild(backend: EditorBackend, ref: string, request: Request): Promise<Response> {
  const body = await readBody(request, BuildRequestSchema);
  if (body instanceof Response) return body;
  return Response.json(BuildSchema.parse(await backend.startBuild(ref, body)), { status: 202 });
}

// The body is `{}`; reading it anyway keeps the content-type rule uniform across every POST.
async function startFlash(backend: EditorBackend, buildId: string, request: Request): Promise<Response> {
  const body = await readBody(request, EmptyBody);
  if (body instanceof Response) return body;
  return Response.json(FlashSchema.parse(await backend.startFlash(buildId)), { status: 202 });
}

async function found<T>(pending: Promise<T | null>, schema: z.ZodType<T>, what: string): Promise<Response> {
  const value = await pending;
  if (value === null) return fail(404, "not_found", `No such ${what}.`);
  return Response.json(schema.parse(value));
}
