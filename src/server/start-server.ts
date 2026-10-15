import { randomBytes } from "node:crypto";
import { checkHost, checkToken } from "./guard.ts";
import type { LayoutSource } from "./layout-source.ts";
import { loadWebAssets } from "./web-assets.ts";
import { LayoutDetailSchema, LayoutListResponseSchema } from "./responses.ts";

export interface ServerOptions {
  port: number;
  source: LayoutSource;
  token?: string;
  open?: boolean;
}

export interface RunningServer {
  url: string;
  token: string;
  stop: () => void;
}

const LIST_PATH = "/api/layouts";
const DETAIL_PREFIX = "/api/layouts/";

// Binds 127.0.0.1 only. Pass port 0 to let the OS pick one; the returned url has the real port.
// Every request, page and asset included, passes the Host check before anything else runs.
export function startServer({ port, source, token, open = false }: ServerOptions): RunningServer {
  const sessionToken = token ?? randomBytes(32).toString("base64url");

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const denied = checkHost(request, boundPort());
      if (denied) return denied;
      const url = new URL(request.url);
      if (url.pathname === LIST_PATH || url.pathname.startsWith(DETAIL_PREFIX)) {
        return api(request, url.pathname);
      }
      return page(request, url.pathname);
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
    if (request.method !== "GET") {
      return new Response("method not allowed", { status: 405, headers: { allow: "GET" } });
    }
    if (pathname === LIST_PATH) {
      return respond(async () =>
        Response.json(LayoutListResponseSchema.parse({ layouts: await source.list() })),
      );
    }
    const ref = parseRef(pathname);
    if (ref === null) return Response.json({ error: "not found" }, { status: 404 });
    return respond(async () => {
      const detail = await source.get(ref);
      if (detail === null) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(LayoutDetailSchema.parse(detail));
    });
  }

  async function page(request: Request, pathname: string): Promise<Response> {
    if (request.method !== "GET") return new Response("not found", { status: 404 });
    return respond(async () => {
      const asset = (await loadWebAssets()).get(pathname);
      if (asset === undefined) return new Response("not found", { status: 404 });
      return new Response(asset.file, { headers: { "content-type": asset.type } });
    });
  }

  const url = `http://127.0.0.1:${boundPort()}/?t=${sessionToken}`;
  if (open && process.platform === "darwin") {
    Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
  }

  return { url, token: sessionToken, stop: () => server.stop(true) };
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
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
