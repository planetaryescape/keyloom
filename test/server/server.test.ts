import { afterEach, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { LayoutDetailSchema, LayoutListResponseSchema } from "../../src/api/http.ts";
import type { LayoutSource } from "../../src/server/layout-source.ts";
import { startServer, type RunningServer } from "../../src/server/start-server.ts";
import { checkHost, checkToken } from "../../src/server/guard.ts";
import { loadFixture } from "./fixture.ts";

const TOKEN = "test-token-0123456789";
const fixture = await loadFixture();

function sourceWith(overrides: Partial<LayoutSource> = {}): LayoutSource {
  return {
    list: async () => [{ id: "moonlander-daily", name: "Daily driver", boardId: "zsa/moonlander", createdAt: 1, updatedAt: 1, revisionId: "rev_1" }],
    get: async (ref) => (ref === "moonlander-daily" ? fixture : null),
    ...overrides,
  };
}

let running: RunningServer | undefined;

afterEach(() => {
  running?.stop();
  running = undefined;
});

function start(source: LayoutSource = sourceWith()): RunningServer & { port: number } {
  running = startServer({ port: 0, source, token: TOKEN });
  const port = Number(new URL(running.url).port);
  return { ...running, port };
}

function api(port: number, path: string, headers: Record<string, string>) {
  return fetch(`http://127.0.0.1:${port}${path}`, { headers });
}

const goodHeaders = { "x-keyloom-token": TOKEN };

// Raw socket, because fetch fills in Host itself and a missing Host is the case under test.
function rawGet(port: number, lines: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write([...lines, "Connection: close", "", ""].join("\r\n"));
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (data += chunk));
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

describe("token and Host checks on /api", () => {
  test("no token gets 401", async () => {
    const { port } = start();
    expect((await api(port, "/api/layouts", { host: `127.0.0.1:${port}` })).status).toBe(401);
  });

  test("a wrong token, and a token of another length, get 401", async () => {
    const { port } = start();
    expect((await api(port, "/api/layouts", { "x-keyloom-token": "nope" })).status).toBe(401);
    expect((await api(port, "/api/layouts", { "x-keyloom-token": TOKEN + "x" })).status).toBe(401);
  });

  test("the token in the query string is not accepted; only the header is", async () => {
    const { port } = start();
    const response = await fetch(`http://127.0.0.1:${port}/api/layouts?t=${TOKEN}`);
    expect(response.status).toBe(401);
  });

  test("the right token with 127.0.0.1 or localhost gets 200", async () => {
    const { port } = start();
    const ip = await fetch(`http://127.0.0.1:${port}/api/layouts`, { headers: goodHeaders });
    expect(ip.status).toBe(200);
    expect(LayoutListResponseSchema.parse(await ip.json()).layouts).toHaveLength(1);
    const named = await fetch(`http://localhost:${port}/api/layouts`, { headers: goodHeaders });
    expect(named.status).toBe(200);
  });

  test("a foreign Host gets 403 even with the right token", async () => {
    const { port } = start();
    expect((await api(port, "/api/layouts", { ...goodHeaders, host: "evil.example" })).status).toBe(403);
    expect((await api(port, "/api/layouts", { ...goodHeaders, host: `evil.example:${port}` })).status).toBe(403);
  });

  test("localhost with a trailing dot, a wrong port, or a missing port gets 403", async () => {
    const { port } = start();
    expect((await api(port, "/api/layouts", { ...goodHeaders, host: `localhost.:${port}` })).status).toBe(403);
    expect((await api(port, "/api/layouts", { ...goodHeaders, host: "localhost" })).status).toBe(403);
    expect((await api(port, "/api/layouts", { ...goodHeaders, host: `127.0.0.1:${port + 1}` })).status).toBe(403);
  });

  test("a Host header with different case is accepted, since host names are case-insensitive", async () => {
    const { port } = start();
    expect((await api(port, "/api/layouts", { ...goodHeaders, host: `LOCALHOST:${port}` })).status).toBe(200);
  });

  // Bun's HTTP parser answers a Host-less HTTP/1.1 request with 400 before routing, so the
  // request never reaches our guard. The assertion is that it gets no layout data.
  test("a request with no Host header gets no layout data", async () => {
    const { port } = start();
    const response = await rawGet(port, ["GET /api/layouts HTTP/1.1", "x-keyloom-token: " + TOKEN]);
    expect(response.startsWith("HTTP/1.1 200")).toBe(false);
    expect(response).not.toContain("layouts");
  });

  test("Host is checked before the token, so a rebound request gets 403 not 401", async () => {
    const { port } = start();
    expect((await api(port, "/api/layouts", { host: "evil.example" })).status).toBe(403);
  });

  test("unknown paths get 404 for a good Host and 403 for a bad one", async () => {
    const { port } = start();
    expect((await api(port, "/nope", { host: `127.0.0.1:${port}` })).status).toBe(404);
    expect((await api(port, "/nope", { host: "evil.example" })).status).toBe(403);
  });
});

describe("GET /api/layouts/:ref", () => {
  test("returns the document, board and geometry, each valid against its schema", async () => {
    const { port } = start();
    const response = await api(port, "/api/layouts/moonlander-daily", goodHeaders);
    expect(response.status).toBe(200);
    const body = LayoutDetailSchema.parse(await response.json());
    expect(body.board.id).toBe("zsa/moonlander");
    expect(body.geometry.keys).toHaveLength(72);
    expect(body.document.layers).toHaveLength(3);
  });

  test("an unknown ref gets 404", async () => {
    const { port } = start();
    expect((await api(port, "/api/layouts/nope", goodHeaders)).status).toBe(404);
  });

  test("a source that throws gets a generic 500 and no internal detail", async () => {
    const { port } = start(
      sourceWith({
        get: async () => {
          throw new Error("secret path /Users/someone/keyloom.db");
        },
      }),
    );
    const response = await api(port, "/api/layouts/moonlander-daily", goodHeaders);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });

  test("a source that returns a value outside the schema gets 500, not the bad value", async () => {
    const broken = { ...fixture, document: { ...fixture.document, schemaVersion: 2 } };
    // SAFETY: schemaVersion 2 is wrong on purpose; the assertion only tells the type checker to
    // accept the value, and the server's schema parse is what must reject it.
    const { port } = start(sourceWith({ get: async () => broken as typeof fixture }));
    expect((await api(port, "/api/layouts/moonlander-daily", goodHeaders)).status).toBe(500);
  });

  test("a list source that throws gets 500", async () => {
    const { port } = start(
      sourceWith({
        list: async () => {
          throw new Error("disk gone");
        },
      }),
    );
    expect((await api(port, "/api/layouts", goodHeaders)).status).toBe(500);
  });
});

describe("Host check covers the page and its assets", () => {
  test("GET / with Host: evil.example gets 403", async () => {
    const { port } = start();
    const response = await api(port, "/", { host: "evil.example" });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("<html");
  });

  test("every asset the page loads gets 403 for a foreign Host, and 200 for the right one", async () => {
    const { port } = start();
    const page = await api(port, "/", { host: `127.0.0.1:${port}` });
    expect(page.status).toBe(200);
    const html = await page.text();
    const paths = [...html.matchAll(/(?:src|href)="(\/[^"]+|\.\/[^"]+)"/g)].map((m) =>
      m[1]!.replace(/^\.\//, "/"),
    );
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect((await api(port, path, { host: "evil.example" })).status).toBe(403);
      const good = await api(port, path, { host: `127.0.0.1:${port}` });
      expect(good.status).toBe(200);
      expect(good.headers.get("content-type")).toBeTruthy();
    }
  });

  test("an unknown path or a traversal attempt is 403 for a foreign Host, and 404 for the right one", async () => {
    const { port } = start();
    for (const path of ["/nope", "/../../etc/passwd", "/%2e%2e/secret"]) {
      expect((await api(port, path, { host: "evil.example" })).status).toBe(403);
      expect((await api(port, path, { host: `127.0.0.1:${port}` })).status).toBe(404);
    }
  });
});

describe("api path handling", () => {
  test("a trailing slash, an encoded slash or a non-GET method does not reach the source", async () => {
    const { port } = start();
    expect((await api(port, "/api/layouts/", goodHeaders)).status).toBe(404);
    expect((await api(port, "/api/layouts/a%2Fb/c", goodHeaders)).status).toBe(404);
    expect((await api(port, "/api/layouts/%E0%A4%A", goodHeaders)).status).toBe(404);
    const post = await fetch(`http://127.0.0.1:${port}/api/layouts`, {
      method: "POST",
      headers: goodHeaders,
    });
    expect(post.status).toBe(405);
  });
});

describe("the page and lifecycle", () => {
  test("the page is served for a good Host", async () => {
    const { port } = start();
    const response = await fetch(`http://127.0.0.1:${port}/?t=${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  test("the url names 127.0.0.1 with the launch token", () => {
    const server = start();
    const url = new URL(server.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.searchParams.get("t")).toBe(TOKEN);
    expect(server.token).toBe(TOKEN);
  });

  test("a launch without a token generates a random one", () => {
    const first = startServer({ port: 0, source: sourceWith() });
    const second = startServer({ port: 0, source: sourceWith() });
    try {
      expect(first.token.length).toBeGreaterThanOrEqual(32);
      expect(first.token).not.toBe(second.token);
    } finally {
      first.stop();
      second.stop();
    }
  });

  test("stop closes the port", async () => {
    const { port, stop } = start();
    stop();
    running = undefined;
    await expect(api(port, "/api/layouts", goodHeaders)).rejects.toThrow();
  });
});

describe("guard helpers", () => {
  test("checkHost accepts only the two exact host strings for the port", () => {
    const request = (host: string | null) =>
      new Request("http://x/", host === null ? {} : { headers: { host } });
    expect(checkHost(request("127.0.0.1:4478"), 4478)).toBeNull();
    expect(checkHost(request("localhost:4478"), 4478)).toBeNull();
    expect(checkHost(request("localhost:4477"), 4478)).not.toBeNull();
    expect(checkHost(request(null), 4478)).not.toBeNull();
  });

  test("checkToken refuses a missing header and a header of the wrong length", () => {
    const withToken = (value?: string) =>
      new Request("http://x/", value === undefined ? {} : { headers: { "x-keyloom-token": value } });
    expect(checkToken(withToken(TOKEN), TOKEN)).toBeNull();
    expect(checkToken(withToken(), TOKEN)?.status).toBe(401);
    expect(checkToken(withToken(""), TOKEN)?.status).toBe(401);
    expect(checkToken(withToken("short"), TOKEN)?.status).toBe(401);
  });
});
