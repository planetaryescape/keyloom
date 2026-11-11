// The remapper setup and System Settings routes (src/api/system-remapper.ts lists them; D-492, D-493). startServer calls
// `handleRemapperSetupRoute` for every /api request after its Host check, and serves the Response when one comes back.
import { z } from "zod";
import type { ApiErrorBody } from "../api/http.ts";
import {
  InstallKanataRequestSchema, OpenSettingsRequestSchema, RemapperSetupResponseSchema, SetupActionResponseSchema, StartKanataRequestSchema,
  type KanataInstallAction, type RemapperSetupResponse, type SetupActionResponse, type SettingsPaneName,
} from "../api/system-remapper.ts";
import { checkToken } from "./guard.ts";

/** What the server needs from the computer to set kanata up. The adapter is src/cli/remapper-setup-backend.ts. */
export interface RemapperSetupBackend {
  status(boardId: string): Promise<RemapperSetupResponse>;
  /** Starts the install or update and returns at once; `status` follows it. Repeated calls share one install. */
  installKanata(action: KanataInstallAction): Promise<SetupActionResponse>;
  /** Stops the running install. */
  cancelInstall(): Promise<SetupActionResponse>;
  startKanata(boardId: string): Promise<SetupActionResponse>;
  openSettings(pane: SettingsPaneName): Promise<SetupActionResponse>;
}

const EmptyBody = z.object({}).strict();
const MAX_BODY_BYTES = 10_000;

const errorResponse = (status: number, code: string, message: string): Response => Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });

type Action = "status" | "install" | "cancel" | "start" | "settings";
const ROUTES: ReadonlyArray<{ method: "GET" | "POST"; path: string; action: Action }> = [
  { method: "GET", path: "/api/system/remapper", action: "status" },
  { method: "POST", path: "/api/system/remapper/install-kanata", action: "install" },
  { method: "POST", path: "/api/system/remapper/install-kanata/cancel", action: "cancel" },
  { method: "POST", path: "/api/system/remapper/start", action: "start" },
  { method: "POST", path: "/api/system/open-settings", action: "settings" },
];

async function readBody(request: Request): Promise<unknown | Response> {
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

/** Null when the request is not one of these routes, so startServer carries on with its own. */
export async function handleRemapperSetupRoute(request: Request, url: URL, backend: RemapperSetupBackend, token: string): Promise<Response | null> {
  const here = ROUTES.filter((route) => route.path === url.pathname);
  if (here.length === 0) return null;
  const denied = checkToken(request, token);
  if (denied) return denied;
  const route = here.find((r) => r.method === request.method);
  if (route === undefined) return new Response("method not allowed", { status: 405, headers: { allow: here.map((r) => r.method).join(", ") } });

  try {
    if (route.action === "status") {
      const board = url.searchParams.get("board");
      if (board === null || board === "") return errorResponse(400, "schema", "Name the board with ?board=.");
      return Response.json(RemapperSetupResponseSchema.parse(await backend.status(board)));
    }
    const body = await readBody(request);
    if (body instanceof Response) return body;
    if (route.action === "cancel") {
      if (!EmptyBody.safeParse(body).success) return errorResponse(400, "schema", "The request body must be an empty object.");
      return Response.json(SetupActionResponseSchema.parse(await backend.cancelInstall()));
    }
    if (route.action === "install") {
      const parsed = InstallKanataRequestSchema.safeParse(body);
      if (!parsed.success) return errorResponse(400, "schema", "Send {} or { action: \"install\" | \"upgrade\" | \"reinstall\" }.");
      return Response.json(SetupActionResponseSchema.parse(await backend.installKanata(parsed.data.action ?? "install")));
    }
    if (route.action === "start") {
      const parsed = StartKanataRequestSchema.safeParse(body);
      if (!parsed.success) return errorResponse(400, "schema", "Send { boardId }.");
      return Response.json(SetupActionResponseSchema.parse(await backend.startKanata(parsed.data.boardId)));
    }
    // Only a pane on the list is opened; anything else is refused before the computer is asked.
    const parsed = OpenSettingsRequestSchema.safeParse(body);
    if (!parsed.success) return errorResponse(400, "schema", "keyloom doesn't open that pane.");
    return Response.json(SetupActionResponseSchema.parse(await backend.openSettings(parsed.data.pane)));
  } catch (err) {
    console.error("keyloom: remapper setup request failed", err);
    return errorResponse(500, "internal", "internal error");
  }
}
