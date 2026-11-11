// The system routes (src/api/system.ts lists them). startServer calls `handleSystemRoute` for every /api request
// after its Host check, and serves the Response when one comes back.
import { z } from "zod";
import { DockerReadinessResponseSchema, DockerStartResponseSchema } from "../api/system.ts";
import type { ApiErrorBody } from "../api/http.ts";
import { InstallRequestSchema, InstallStateSchema, InstallableToolSchema } from "../api/tool-install.ts";
import { checkToken } from "./guard.ts";
import type { SystemBackend } from "./system-backend.ts";

const EmptyBody = z.object({}).strict();

const errorResponse = (status: number, code: string, message: string): Response => Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

type Action = "docker" | "startDocker" | "install" | "installState";
const ROUTES: ReadonlyArray<{ method: "GET" | "POST"; path: string; action: Action }> = [
  { method: "GET", path: "/api/system/docker", action: "docker" },
  { method: "POST", path: "/api/system/docker/start", action: "startDocker" },
  { method: "POST", path: "/api/system/install", action: "install" },
  { method: "GET", path: "/api/system/install", action: "installState" },
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
    if (route.action === "installState") {
      const tool = InstallableToolSchema.safeParse(new URL(request.url).searchParams.get("tool"));
      if (!tool.success) return errorResponse(400, "schema", "Name the tool: ?tool=docker, zapp, dfu-util, dfu-programmer or avrdude.");
      return Response.json(InstallStateSchema.parse(await backend.installState(tool.data)));
    }
    // Reading `{}` keeps the content-type rule the same on every POST.
    const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return errorResponse(415, "content_type", "Send this request as application/json.");
    if (route.action === "install") {
      const body = InstallRequestSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return errorResponse(400, "schema", "Name the tool to install: docker, zapp, dfu-util, dfu-programmer or avrdude.");
      return Response.json(InstallStateSchema.parse(await backend.install(body.data.tool)));
    }
    const parsed = EmptyBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, "schema", "The request body must be an empty object.");
    return Response.json(DockerStartResponseSchema.parse(await backend.startDocker()));
  } catch (err) {
    console.error("keyloom: system request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
