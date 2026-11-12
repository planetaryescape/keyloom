import { randomBytes } from "node:crypto";
import type { BoardDevView } from "../boards/dev.ts";
import { BoardDevViewSchema } from "../boards/dev.ts";
import type { ChatBackend } from "./chat-backend.ts";
import { handleConfigRoute } from "./config-routes.ts";
import { handleLabRoute } from "./lab-routes.ts";
import type { LabBackend } from "./lab-backend.ts";
import type { ConfigsBackend } from "./configs-backend.ts";
import type { KeyboardsBackend } from "./keyboards-backend.ts";
import { handleKeyboardRoute } from "./keyboard-routes.ts";
import type { ReviewBackend } from "./review-backend.ts";
import { handleReviewRoute } from "./review-routes.ts";
import { handleChatRoute } from "./chat-routes.ts";
import type { DecisionsBackend } from "./decisions-backend.ts";
import { handleDecisionRoute } from "./decisions-routes.ts";
import type { EditorBackend } from "./editor-backend.ts";
import { MAX_IMPORT_BYTES, handleEditorRoute, isEditorPath } from "./editor-routes.ts";
import { checkHost, checkToken } from "./guard.ts";
import type { LayoutSource } from "./layout-source.ts";
import type { SyncBackend } from "./sync-backend.ts";
import { handleSyncRoute } from "./sync-routes.ts";
import { handleSystemRoute } from "./system-routes.ts";
import type { SystemBackend } from "./system-backend.ts";
import { type RemapperSetupBackend, handleRemapperSetupRoute } from "./system-remapper-routes.ts";
import { notFoundPage } from "./not-found-page.ts";
import { type RestartBackend, handleRestartRoute } from "./restart-routes.ts";
import { loadWebAssets } from "./web-assets.ts";
import { LayoutDetailSchema, LayoutListResponseSchema, type ApiErrorBody } from "../api/http.ts";

export interface ServerOptions {
  port: number;
  source: LayoutSource;
  /** The rung 2 write side. Without it the write routes answer 404, as if they did not exist. */
  editor?: EditorBackend;
  /** The rung 3 chat side. Without it the chat routes fall through to the layout routes' 404. */
  chat?: ChatBackend;
  /** The rung 6 decisions side. Without it the decisions routes fall through to a 404. */
  decisions?: DecisionsBackend;
  /** The rung 13 keyboard sync side. Without it the sync routes and /api/events fall through to a 404. */
  sync?: SyncBackend;
  /** The rung 23 configs and versions side. Without it the /api/configs routes fall through to a 404. */
  configs?: ConfigsBackend;
  /** The new-keyboard side (22, D-336). Without it the /api/keyboards routes fall through to a 404. */
  keyboards?: KeyboardsBackend;
  /** The board review (D-340). Without it the /api/layouts/:ref/review routes fall through to the layout routes' 404. */
  review?: ReviewBackend;
  /** The typing lab (rung 22). Without it the /api/lab routes fall through to a 404. */
  lab?: LabBackend;
  /** The computer's own state (rung 25): whether Docker is up, and starting it. Without it /api/system falls through to a 404. */
  system?: SystemBackend;
  /** Setting up the MacBook remapper and opening System Settings panes (D-492, D-493). Without it those routes fall through to a 404. */
  remapperSetup?: RemapperSetupBackend;
  /** Restarting keyloom from the page (R5-15). Without it /api/restart falls through to a 404. */
  restart?: RestartBackend;
  /** `keyloom serve --board-dev`: reads the board folder afresh on every request, so edits to board.json show on reload. */
  boardDev?: () => Promise<BoardDevView>;
  token?: string;
  open?: boolean;
}

export interface RunningServer {
  url: string;
  token: string;
  stop: () => void;
  /** Resolves when background work the server started (a flash in progress) has finished; awaited after stop() so the database outlives it. */
  drain?: () => Promise<void>;
}

const BOARD_DEV_PATH = "/api/board-dev";
const LIST_PATH = "/api/layouts";
const DETAIL_PREFIX = "/api/layouts/";
// Starting or restarting Docker waits up to about three minutes for the daemon, past Bun's 10 s idle limit. On Bun 1.3.14 that limit cut
// a request with no body and spared one with a JSON body, which is what the page sends, so this guards against relying on that.
const NO_IDLE_LIMIT = new Set(["/api/system/docker/start", "/api/system/docker/restart"]);

// Binds 127.0.0.1 only. Pass port 0 to let the OS pick one; the returned url has the real port.
// Every request, page and asset included, passes the Host check before anything else runs.
export function startServer({ port, source, editor, chat, decisions, sync, configs, keyboards, review, lab, system, remapperSetup, restart, boardDev, token, open = false }: ServerOptions): RunningServer {
  const sessionToken = token ?? randomBytes(32).toString("base64url");

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    // The JSON routes enforce their own, smaller limit; only the upload route needs this one.
    maxRequestBodySize: MAX_IMPORT_BYTES,
    async fetch(request) {
      const denied = checkHost(request, boundPort());
      if (denied) return denied;
      const url = new URL(request.url);
      if (NO_IDLE_LIMIT.has(url.pathname)) server.timeout(request, 0);
      // Before the layout routes: POST /api/layouts/:ref/chat shares their prefix. The handler checks
      // the token itself and answers null for any path that isn't a chat route.
      if (chat !== undefined) {
        const chatResponse = await handleChatRoute(request, url.pathname, chat, sessionToken);
        if (chatResponse !== null) return chatResponse;
      }
      // Also before the layout routes, whose prefix /api/layouts/:ref/review shares.
      if (review !== undefined) {
        const reviewResponse = await handleReviewRoute(request, url.pathname, review, sessionToken);
        if (reviewResponse !== null) return reviewResponse;
      }
      if (decisions !== undefined) {
        const decisionResponse = await handleDecisionRoute(request, url.pathname, decisions, sessionToken);
        if (decisionResponse !== null) return decisionResponse;
      }
      if (sync !== undefined) {
        const syncResponse = await handleSyncRoute(request, url.pathname, sync, sessionToken);
        if (syncResponse !== null) return syncResponse;
      }
      if (lab !== undefined) {
        const labResponse = await handleLabRoute(request, url.pathname, lab, sessionToken);
        if (labResponse !== null) return labResponse;
      }
      if (configs !== undefined) {
        const configResponse = await handleConfigRoute(request, url.pathname, configs, sessionToken);
        if (configResponse !== null) return configResponse;
      }
      if (keyboards !== undefined) {
        const keyboardResponse = await handleKeyboardRoute(request, url.pathname, keyboards, sessionToken);
        if (keyboardResponse !== null) return keyboardResponse;
      }
      if (system !== undefined) {
        const systemResponse = await handleSystemRoute(request, url.pathname, system, sessionToken);
        if (systemResponse !== null) return systemResponse;
      }
      if (remapperSetup !== undefined) {
        const setupResponse = await handleRemapperSetupRoute(request, url, remapperSetup, sessionToken);
        if (setupResponse !== null) return setupResponse;
      }
      if (restart !== undefined) {
        const restartResponse = await handleRestartRoute(request, url.pathname, restart, sessionToken);
        if (restartResponse !== null) return restartResponse;
      }
      if (url.pathname === LIST_PATH || url.pathname === BOARD_DEV_PATH || url.pathname.startsWith(DETAIL_PREFIX) || isEditorPath(url.pathname)) {
        return api(request, url.pathname);
      }
      return page(request, url);
    },
  });

  // Bun types the port as optional because a server can also listen on a unix socket.
  // This server always binds TCP, so an absent port is a bug.
  function boundPort(): number {
    const port = server.port;
    if (port === undefined) throw new Error("keyloom: server is not listening on a TCP port");
    return port;
  }

  async function api(request: Request, pathname: string): Promise<Response> {
    const denied = checkToken(request, sessionToken);
    if (denied) return denied;
    if (isEditorPath(pathname)) {
      if (editor === undefined) return notFound();
      return respond(async () => (await handleEditorRoute(request, pathname, editor)) ?? notFound());
    }
    if (request.method !== "GET") {
      return new Response("method not allowed", { status: 405, headers: { allow: "GET" } });
    }
    if (pathname === BOARD_DEV_PATH) {
      if (boardDev === undefined) return notFound();
      return respond(async () => Response.json(BoardDevViewSchema.parse(await boardDev())));
    }
    if (pathname === LIST_PATH) {
      return respond(async () =>
        Response.json(LayoutListResponseSchema.parse({ layouts: await source.list() })),
      );
    }
    const ref = parseRef(pathname);
    if (ref === null) return notFound();
    return respond(async () => {
      const detail = await source.get(ref);
      if (detail === null) return notFound();
      return Response.json(LayoutDetailSchema.parse(detail));
    });
  }

  async function page(request: Request, url: URL): Promise<Response> {
    // An address the server doesn't know: JSON for the API, and for a page a way back into the app (R1-07).
    if (url.pathname.startsWith("/api/")) return notFound();
    if (request.method !== "GET") return new Response("not found", { status: 404 });
    return respond(async () => {
      const asset = (await loadWebAssets()).get(url.pathname);
      if (asset === undefined) return notFoundPage(url.searchParams.get("t") === sessionToken ? sessionToken : null);
      return new Response(asset.file, { headers: { "content-type": asset.type } });
    });
  }

  // The page picks its mode from the link, so a board-dev server never shows the layout app.
  const url = `http://127.0.0.1:${boundPort()}/?t=${sessionToken}${boardDev ? "&mode=board-dev" : ""}`;
  if (open && process.platform === "darwin") {
    Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
  }

  return { url, token: sessionToken, stop: () => server.stop(true) };
}

// Coded like every route's refusals, so the page maps the code to its words and buttons (R7-01) instead of showing a status number.
function coded(status: number, code: "internal" | "not_found", message: string): Response {
  return Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });
}

// `generic` marks the catch-all, whose "not found" is no sentence for a person: the page says it in its own words, and keeps a route's own
// `not_found` sentence, such as "This build has no firmware file. Build it again." (D-534).
function notFound(): Response {
  return Response.json({ error: { code: "not_found", message: "not found", generic: true } } satisfies ApiErrorBody, { status: 404 });
}

// The ref is the single path segment after /api/layouts/. A malformed escape is a 404,
// not a 500, because the client built the URL from a known id.
function parseRef(pathname: string): string | null {
  const raw = pathname.slice(DETAIL_PREFIX.length);
  if (raw.length === 0 || raw.includes("/")) return null;
  try {
    const ref = decodeURIComponent(raw);
    return ref.length > 0 ? ref : null;
  } catch {
    return null;
  }
}

// Source, validation and bundling failures become a generic 500. The detail goes to the log only.
async function respond(build: () => Promise<Response>): Promise<Response> {
  try {
    return await build();
  } catch (error) {
    console.error("keyloom: request failed", error);
    return coded(500, "internal", "internal error");
  }
}
