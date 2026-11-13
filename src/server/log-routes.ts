// GET /api/log and POST /api/log/show (src/api/server-log.ts, R8-09). startServer calls `handleLogRoute` for every /api request after
// its Host check.
import { z } from "zod";
import type { ApiErrorBody } from "../api/http.ts";
import { LOG_PATH, LogShownSchema, SHOW_LOG_PATH, ServerLogSchema } from "../api/server-log.ts";
import { LogShowError, type ServerLog } from "../app/server-log.ts";
import { checkToken } from "./guard.ts";

export interface LogBackend {
  readonly log: ServerLog;
  /** Opens the log in its default app; throws LogShowError. */
  show(): Promise<void>;
}

const EmptyBody = z.strictObject({});

const errorResponse = (status: number, code: string, message: string): Response => Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

/** Null when the request is not a log route. */
export async function handleLogRoute(request: Request, pathname: string, backend: LogBackend, token: string): Promise<Response | null> {
  if (pathname !== LOG_PATH && pathname !== SHOW_LOG_PATH) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  if (pathname === LOG_PATH) {
    if (request.method !== "GET") return new Response("method not allowed", { status: 405, headers: { allow: "GET" } });
    return Response.json(ServerLogSchema.parse(backend.log));
  }
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return errorResponse(415, "content_type", "Send this request as application/json.");
  if (!EmptyBody.safeParse(await request.json().catch(() => null)).success) return errorResponse(400, "schema", "The request body must be an empty object.");
  try {
    await backend.show();
  } catch (error) {
    if (!(error instanceof LogShowError)) throw error;
    return errorResponse(error.code === "log_open_failed" ? 500 : 409, error.code, error.message);
  }
  return Response.json(LogShownSchema.parse({ shown: true }));
}
