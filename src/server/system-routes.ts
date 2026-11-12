// The system routes (src/api/system.ts lists them). startServer calls `handleSystemRoute` for every /api request
// after its Host check, and serves the Response when one comes back.
import { z } from "zod";
import { DockerReadinessResponseSchema, DockerRestartRequestSchema, DockerStartResponseSchema, KarabinerConfigResponseSchema } from "../api/system.ts";
import type { ApiErrorBody } from "../api/http.ts";
import { InstallRequestSchema, InstallStateSchema, InstallableToolSchema } from "../api/tool-install.ts";
import { checkToken } from "./guard.ts";
import type { SystemBackend } from "./system-backend.ts";

const EmptyBody = z.object({}).strict();

const errorResponse = (status: number, code: string, message: string): Response => Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

type Action = "docker" | "startDocker" | "install" | "installState" | "cancelInstall" | "restartDocker" | "fixColimaFiles" | "karabinerConfig";
const ROUTES: ReadonlyArray<{ method: "GET" | "POST" | "DELETE"; path: string; action: Action }> = [
  { method: "GET", path: "/api/system/docker", action: "docker" },
  { method: "POST", path: "/api/system/docker/start", action: "startDocker" },
  { method: "POST", path: "/api/system/install", action: "install" },
  { method: "GET", path: "/api/system/install", action: "installState" },
  { method: "GET", path: "/api/system/karabiner-config", action: "karabinerConfig" },
  { method: "DELETE", path: "/api/system/install", action: "cancelInstall" },
  { method: "POST", path: "/api/system/docker/restart", action: "restartDocker" },
  { method: "POST", path: "/api/system/docker/fix-colima-files", action: "fixColimaFiles" },
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
    if (route.action === "karabinerConfig") {
      if (backend.karabinerConfig === undefined) return errorResponse(404, "karabiner_unavailable", "keyloom can't read Karabiner's settings here. Drop a copy of karabiner.json instead.");
      const read = await backend.karabinerConfig();
      if (read.status === "missing") return errorResponse(404, "karabiner_missing", "Karabiner-Elements has no settings file on this Mac, so there is nothing to bring in. Its rules start when you set it up.");
      if (read.status === "too_large") return errorResponse(413, "karabiner_too_large", "karabiner.json on this Mac is too large to be Karabiner's settings.");
      if (read.status === "denied") return errorResponse(403, "karabiner_denied", "macOS didn't let keyloom read Karabiner's settings. Drop a copy of karabiner.json here instead.");
      if (read.status === "not_a_file") return errorResponse(422, "karabiner_not_a_file", "~/.config/karabiner/karabiner.json on this Mac isn't a file keyloom can read. Drop a copy of karabiner.json here instead.");
      return Response.json(KarabinerConfigResponseSchema.parse({ filename: read.filename, content: read.content }));
    }
    if (route.action === "installState" || route.action === "cancelInstall") {
      const tool = InstallableToolSchema.safeParse(new URL(request.url).searchParams.get("tool"));
      if (!tool.success) return errorResponse(400, "schema", "Name the tool: ?tool=docker, zapp, dfu-util, dfu-programmer, avrdude or codex.");
      const state = route.action === "installState" ? await backend.installState(tool.data) : await backend.cancelInstall(tool.data);
      return Response.json(InstallStateSchema.parse(state));
    }
    // Reading `{}` keeps the content-type rule the same on every POST.
    const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return errorResponse(415, "content_type", "Send this request as application/json.");
    if (route.action === "install") {
      const body = InstallRequestSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return errorResponse(400, "schema", "Name the tool to install: docker, zapp, dfu-util, dfu-programmer, avrdude or codex.");
      return Response.json(InstallStateSchema.parse(await backend.install(body.data.tool)));
    }
    const body: unknown = await request.json().catch(() => null);
    if (route.action === "restartDocker") {
      const restart = DockerRestartRequestSchema.safeParse(body);
      if (!restart.success) return errorResponse(400, "schema", "The request body must be {} or {\"force\": true}.");
      return Response.json(DockerStartResponseSchema.parse(await backend.restartDocker("force" in restart.data && restart.data.force ? { force: true } : {})));
    }
    const parsed = EmptyBody.safeParse(body);
    if (!parsed.success) return errorResponse(400, "schema", "The request body must be an empty object.");
    if (route.action === "fixColimaFiles") return Response.json(DockerStartResponseSchema.parse(await backend.fixColimaFiles()));
    return Response.json(DockerStartResponseSchema.parse(await backend.startDocker()));
  } catch (err) {
    console.error("keyloom: system request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
