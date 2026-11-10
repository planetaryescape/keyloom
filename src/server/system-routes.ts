// The system routes (src/api/system.ts lists them). startServer calls `handleSystemRoute` for every /api request
// after its Host check, and serves the Response when one comes back.
import { z } from "zod";
import { DockerReadinessResponseSchema, DockerStartResponseSchema } from "../api/system.ts";
import type { ApiErrorBody } from "../api/http.ts";
import { checkToken } from "./guard.ts";
import type { SystemBackend } from "./system-backend.ts";

const EmptyBody = z.object({}).strict();

const errorResponse = (status: number, code: string, message: string): Response => Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

type Action = "docker" | "startDocker";
const ROUTES: ReadonlyArray<{ method: "GET" | "POST"; path: string; action: Action }> = [
  { method: "GET", path: "/api/system/docker", action: "docker" },
  { method: "POST", path: "/api/system/docker/start", action: "startDocker" },
];

/** Null when the request is not a system route, so startServer carries on with its own. */
export async function handleSystemRoute(request: Request, pathname: string, backend: SystemBackend, token: string): Promise<Response | null> {
  const here = ROUTES.filter((route) => route.path === pathname);
  if (here.length === 0) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  const route = here.find((r) => r.method === request.method);
  if (route === undefined) return new Response("method not allowed", { status: 405, headers: { allow: here.map((r) => r.method).join(", ") } });

  try {
    if (route.action === "docker") return Response.json(DockerReadinessResponseSchema.parse(await backend.docker()));
    // Reading `{}` keeps the content-type rule the same on every POST.
    const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return errorResponse(415, "content_type", "Send this request as application/json.");
    const parsed = EmptyBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, "schema", "The request body must be an empty object.");
    return Response.json(DockerStartResponseSchema.parse(await backend.startDocker()));
  } catch (err) {
    console.error("keyloom: system request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
