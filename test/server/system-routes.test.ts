// The system routes (src/api/system.ts, D-486): the Docker a build needs, and starting it. Over a fake backend,
// so nothing here looks for a daemon.
import { afterAll, describe, expect, test } from "bun:test";
import { DockerReadinessResponseSchema, DockerStartResponseSchema } from "../../src/api/system.ts";
import { handleSystemRoute } from "../../src/server/system-routes.ts";
import type { SystemBackend } from "../../src/server/system-backend.ts";

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => servers.forEach((s) => s.stop(true)));

const backend: SystemBackend = {
  docker: async () => ({ ok: false, problem: "daemon-down", reason: "the docker daemon isn't running", engine: "Docker Desktop", canStart: true, autoStart: true, install: null }),
  startDocker: async () => ({ ok: true, version: "28.0.1", engine: "Docker Desktop", waitedMs: 21_000 }),
};

async function serve() {
  const server = Bun.serve({ port: 0, fetch: async (r) => (await handleSystemRoute(r, new URL(r.url).pathname, backend, TOKEN)) ?? new Response("not a system route", { status: 404 }) });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), ...init.headers } });
  const post = (path: string) => call(path, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  return { call, post };
}

describe("the Docker routes", () => {
  test("the readiness read says what is wrong and what would fix it", async () => {
    const { call } = await serve();
    const response = await call("/api/system/docker");
    expect(response.status).toBe(200);
    expect(DockerReadinessResponseSchema.parse(await response.json())).toMatchObject({ ok: false, engine: "Docker Desktop", canStart: true });
  });

  test("a start comes back as data, not as an error, because its sentence is what the person reads", async () => {
    const { post } = await serve();
    const response = await post("/api/system/docker/start");
    expect(response.status).toBe(200);
    expect(DockerStartResponseSchema.parse(await response.json())).toMatchObject({ ok: true, engine: "Docker Desktop" });
  });

  test("the guard: a token on every route, JSON on the write, and the method named when it is wrong", async () => {
    const { call } = await serve();
    expect((await call("/api/system/docker", {}, null)).status).toBe(401);
    expect((await call("/api/system/docker/start", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }, null)).status).toBe(401);
    expect((await call("/api/system/docker/start", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("/api/system/docker/start")).status).toBe(405);
  });

  test("anything else falls through, so a server without these routes answers as it always did", async () => {
    const { call } = await serve();
    expect((await call("/api/system/other")).status).toBe(404);
  });
});
