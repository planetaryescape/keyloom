// keyloom's ModelTools as a loopback MCP server, so a Codex run (a foreign agent loop) can call the
// same tools, with the same validator and three-attempt rule, as the Anthropic loop (D-108, D-110).
// The tools run inside this process, so the recorder, the validator and the database handle are
// shared; nothing about a layout is decided on Codex's side of the wire.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

function authorised(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? "";
  const given = Buffer.from(header);
  const want = Buffer.from(`Bearer ${token}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** A tool throws to report a problem to the model (an invalid proposal, say); that is a result it can read, not a protocol error. */
async function callTool(tools: Map<string, ModelTool>, name: string, input: unknown) {
  const tool = tools.get(name);
  if (!tool) return { isError: true, content: [{ type: "text" as const, text: `unknown tool "${name}"` }] };
  try {
    return { content: [{ type: "text" as const, text: await tool.run(input) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] };
  }
}

// Stateless: each POST gets its own Server and transport, so there is no session to leak between runs
// and nothing to clean up if Codex drops a connection.
async function handle(tools: Map<string, ModelTool>, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const server = new Server({ name: "keyloom", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map((tool) => ({ name: tool.name, description: tool.description, inputSchema: schemaOf(tool) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (call) => callTool(tools, call.params.name, call.params.arguments ?? {}));
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  // The SDK's transport types are not written for exactOptionalPropertyTypes; the objects are compatible at runtime.
  await server.connect(transport as unknown as Transport);
  await transport.handleRequest(request, response);
}

export async function startToolServer(tools: ModelTool[]): Promise<ToolServer> {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const token = randomBytes(32).toString("hex");
  const http = createServer((request, response) => {
    const reject = (status: number, message: string) => {
      response.writeHead(status, { "content-type": "text/plain" }).end(message);
    };
    if (!authorised(request, token)) return reject(401, "unauthorised");
    if (request.url?.split("?")[0] !== ENDPOINT) return reject(404, "not found");
    // Only POST: there is no server-initiated stream and no session to delete.
    if (request.method !== "POST") return reject(405, "method not allowed");
    handle(byName, request, response).catch((err: unknown) => {
      console.error("keyloom: codex tool server failed", err);
      if (!response.headersSent) reject(500, "internal error");
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    // 127.0.0.1 only, on a port the OS picks: nothing else on the network can reach it, and the token stops other local users.
    http.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${ENDPOINT}`,
    token,
    stop: () => new Promise<void>((resolve) => {
      http.closeAllConnections();
      http.close(() => resolve());
    }),
  };
}
