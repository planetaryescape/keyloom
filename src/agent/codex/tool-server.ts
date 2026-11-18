// keyloom's ModelTools as a loopback MCP server, so a Codex run (a foreign agent loop) can call the
// same tools, with the same validator and three-attempt rule, as the Anthropic loop (D-108, D-110).
// The tools run inside this process, so the recorder, the validator and the database handle are
// shared; nothing about a layout is decided on Codex's side of the wire.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, CancelledNotificationSchema, ListToolsRequestSchema, type RequestId } from "@modelcontextprotocol/sdk/types.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ModelTool } from "../model.ts";

export type ToolServer = {
  /** The streamable-HTTP endpoint, on 127.0.0.1. */
  url: string;
  /** The bearer token this run's server accepts; pass it to Codex through an environment variable, never the command line. */
  token: string;
  stop(): Promise<void>;
};

const ENDPOINT = "/mcp";

/** The JSON Schema Codex is shown. `reused: "inline"` avoids `$ref`s, which not every MCP client resolves. */
const schemaOf = (tool: ModelTool) => {
  const { $schema: _dropped, ...schema } = z.toJSONSchema(tool.inputSchema, { reused: "inline" }) as Record<string, unknown>;
  return schema as { type: "object"; [key: string]: unknown };
};

function authorised(request: Request, token: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header);
  const want = Buffer.from(`Bearer ${token}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** A tool throws to report a problem to the model (an invalid proposal, say); that is a result it can read, not a protocol error. */
async function callTool(tools: Map<string, ModelTool>, name: string, input: unknown, signal: AbortSignal) {
  const tool = tools.get(name);
  if (!tool) return { isError: true, content: [{ type: "text" as const, text: `unknown tool "${name}"` }] };
  try {
    return { content: [{ type: "text" as const, text: await tool.run(input, signal) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] };
  }
}

// Stateless: each POST gets its own Server and transport, so there is no session to leak between runs
// and nothing to clean up if Codex drops a connection.
async function handle(tools: Map<string, ModelTool>, running: Map<RequestId, AbortController>, request: Request): Promise<Response> {
  const server = new Server({ name: "keyloom", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map((tool) => ({ name: tool.name, description: tool.description, inputSchema: schemaOf(tool) })),
  }));
  // A cancel notification is its own POST, so it reaches a different Server from the call it names.
  server.setNotificationHandler(CancelledNotificationSchema, (notification) => {
    const { requestId } = notification.params;
    if (requestId !== undefined) running.get(requestId)?.abort();
  });
  server.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
    const cancelled = new AbortController();
    running.set(extra.requestId, cancelled);
    try {
      // `request.signal` is how a dropped connection shows: Bun's node:http reports no close while a handler is still working.
      return await callTool(tools, call.params.name, call.params.arguments ?? {}, AbortSignal.any([request.signal, cancelled.signal]));
    } finally {
      if (running.get(extra.requestId) === cancelled) running.delete(extra.requestId);
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  try {
    // The SDK's transport types are not written for exactOptionalPropertyTypes; the objects are compatible at runtime.
    await server.connect(transport as unknown as Transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export async function startToolServer(tools: ModelTool[]): Promise<ToolServer> {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const running = new Map<RequestId, AbortController>();
  const token = randomBytes(32).toString("hex");
  // 127.0.0.1 only, on a port the OS picks: nothing else on the network can reach it, and the token stops other local users.
  // idleTimeout 0: a tool can work for longer than Bun's 10 seconds without sending anything.
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (!authorised(request, token)) return new Response("unauthorised", { status: 401 });
      if (new URL(request.url).pathname !== ENDPOINT) return new Response("not found", { status: 404 });
      // Only POST: there is no server-initiated stream and no session to delete.
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      try {
        return await handle(byName, running, request);
      } catch (err) {
        console.error("keyloom: codex tool server failed", err);
        return new Response("internal error", { status: 500 });
      }
    },
  });
  return {
    url: `http://127.0.0.1:${http.port}${ENDPOINT}`,
    token,
    stop: () => http.stop(true),
  };
}
