// GET and POST /api/restart (src/api/restart.ts). startServer calls `handleRestartRoute` for every /api request after its Host check.
import { z } from "zod";
import type { ApiErrorBody } from "../api/http.ts";
import { RESTART_PATH, RestartInfoSchema, RestartStartedSchema } from "../api/restart.ts";
import { checkToken } from "./guard.ts";

export interface RestartBackend {
  /** True when the desktop app started this server and starts it again when it exits. */
  readonly canRestart: boolean;
  /** The line that starts this server again in a terminal. */
  readonly command: string;
  /** Stops the server the way Ctrl-C does, letting a keyboard write finish, and exits with RESTART_EXIT_CODE. Called after the answer is sent. */
  restart(): void;
}

const EmptyBody = z.strictObject({});

const errorResponse = (status: number, code: string, message: string): Response => Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

/** Null when the request is not the restart route. */
export async function handleRestartRoute(request: Request, pathname: string, backend: RestartBackend, token: string): Promise<Response | null> {
  if (pathname !== RESTART_PATH) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  if (request.method === "GET") return Response.json(RestartInfoSchema.parse({ canRestart: backend.canRestart, command: backend.command }));
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "GET, POST" } });
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return errorResponse(415, "content_type", "Send this request as application/json.");
  if (!EmptyBody.safeParse(await request.json().catch(() => null)).success) return errorResponse(400, "schema", "The request body must be an empty object.");
  if (!backend.canRestart) {
    return errorResponse(409, "restart_unsupervised", `keyloom runs in a terminal here, so it can't start itself again. Stop it there with Ctrl-C, then run \`${backend.command}\`.`);
  }
  // After this answer is on its way: the stop closes the server, and the page should hear that the restart began.
  setTimeout(() => backend.restart(), 0);
  return Response.json(RestartStartedSchema.parse({ restarting: true }), { status: 202 });
}
