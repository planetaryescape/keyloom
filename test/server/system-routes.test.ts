// The system routes (src/api/system.ts, D-486): the Docker a build needs, and starting it. Over a fake backend,
// so nothing here looks for a daemon.
import { afterAll, describe, expect, test } from "bun:test";
import { DockerReadinessResponseSchema, DockerStartResponseSchema, KarabinerConfigResponseSchema } from "../../src/api/system.ts";
import { InstallStateSchema } from "../../src/api/tool-install.ts";
import { handleSystemRoute } from "../../src/server/system-routes.ts";
import type { SystemBackend } from "../../src/server/system-backend.ts";

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => servers.forEach((s) => s.stop(true)));

const backend: SystemBackend = {
  docker: async () => ({ ok: false, problem: "daemon-down", reason: "the docker daemon isn't running", engine: "Docker Desktop", canStart: true, autoStart: true, install: null, access: null }),
  startDocker: async () => ({ ok: true, version: "28.0.1", engine: "Docker Desktop", waitedMs: 21_000 }),
  install: async (tool) => ({ tool, status: "running", phase: "installing", logTail: [], error: null, errorCode: null }),
  installState: async (tool) => ({ tool, status: "succeeded", phase: null, logTail: ["==> Pouring zapp"], error: null, errorCode: null }),
  cancelInstall: async (tool) => { cancelled.push(tool); return { tool, status: "running", phase: "stopping", logTail: ["keyloom: stopping the install"], error: null, errorCode: null }; },
  restartDocker: async (opts) => { restarts += 1; forced.push(opts?.force === true); return { ok: true, version: "28.0.1", engine: "OrbStack", waitedMs: 4_000 }; },
};
const forced: boolean[] = [];
const cancelled: string[] = [];
let restarts = 0;

async function serve() {
  const server = Bun.serve({ port: 0, fetch: async (r) => (await handleSystemRoute(r, new URL(r.url).pathname, backend, TOKEN)) ?? new Response("not a system route", { status: 404 }) });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), ...init.headers } });
  const post = (path: string) => call(path, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  return { call, post };
}

describe("the install routes (D-488, D-489)", () => {
  test("a POST starts an install of a named tool and the GET follows it", async () => {
    const { call } = await serve();
    const started = await call("/api/system/install", { method: "POST", body: JSON.stringify({ tool: "zapp" }), headers: { "content-type": "application/json" } });
    expect(started.status).toBe(200);
    expect(InstallStateSchema.parse(await started.json())).toMatchObject({ tool: "zapp", status: "running" });
    const followed = await call("/api/system/install?tool=zapp");
    expect(InstallStateSchema.parse(await followed.json())).toMatchObject({ tool: "zapp", status: "succeeded", logTail: ["==> Pouring zapp"] });
  });

  test("only the tools keyloom knows are installed, and the guard is the same as every route's", async () => {
    const { call } = await serve();
    expect((await call("/api/system/install", { method: "POST", body: JSON.stringify({ tool: "rm -rf" }), headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await call("/api/system/install", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await call("/api/system/install?tool=curl")).status).toBe(400);
    // The chat's Install Codex goes through the same job (R3-24).
    expect(InstallStateSchema.parse(await (await call("/api/system/install", { method: "POST", body: JSON.stringify({ tool: "codex" }), headers: { "content-type": "application/json" } })).json())).toMatchObject({ tool: "codex", status: "running" });
    expect((await call("/api/system/install", { method: "POST", body: JSON.stringify({ tool: "zapp" }), headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("/api/system/install?tool=zapp", {}, null)).status).toBe(401);
    expect((await call("/api/system/install", { method: "PUT" })).status).toBe(405);
  });

  test("a DELETE stops the named install, and names only a tool keyloom knows (R2-08)", async () => {
    const { call } = await serve();
    const response = await call("/api/system/install?tool=docker", { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(InstallStateSchema.parse(await response.json())).toMatchObject({ tool: "docker", status: "running", phase: "stopping" });
    expect(cancelled).toEqual(["docker"]);
    expect((await call("/api/system/install?tool=curl", { method: "DELETE" })).status).toBe(400);
    expect((await call("/api/system/install?tool=docker", { method: "DELETE" }, null)).status).toBe(401);
    expect(cancelled).toEqual(["docker"]);
  });
});

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

  test("a restart is a POST that answers like a start, behind the same guard (R2-07)", async () => {
    const { call, post } = await serve();
    const response = await post("/api/system/docker/restart");
    expect(response.status).toBe(200);
    expect(DockerStartResponseSchema.parse(await response.json())).toMatchObject({ ok: true, engine: "OrbStack" });
    expect(restarts).toBe(1);
    expect((await call("/api/system/docker/restart", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }, null)).status).toBe(401);
    expect((await call("/api/system/docker/restart", { method: "POST", body: "{\"x\":1}", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await call("/api/system/docker/restart")).status).toBe(405);
    expect(restarts).toBe(1);
    // A build that failed on the engine's state asks for a forced restart (R6-09); only `force` is accepted beside the empty body.
    expect((await call("/api/system/docker/restart", { method: "POST", body: "{\"force\":true}", headers: { "content-type": "application/json" } })).status).toBe(200);
    expect((await call("/api/system/docker/restart", { method: "POST", body: "{\"force\":true,\"x\":1}", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect(forced).toEqual([false, true]);
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

// R1-24: the MacBook's import card reads Karabiner's settings from their fixed place instead of asking for a hidden file.
describe("the Karabiner settings read", () => {
  async function serveWith(karabinerConfig: SystemBackend["karabinerConfig"]) {
    const server = Bun.serve({
      port: 0,
      fetch: async (r) => (await handleSystemRoute(r, new URL(r.url).pathname, { ...backend, ...(karabinerConfig === undefined ? {} : { karabinerConfig }) }, TOKEN)) ?? new Response("no", { status: 404 }),
    });
    servers.push(server);
    return (token: string | null = TOKEN) => fetch(`http://127.0.0.1:${server.port}/api/system/karabiner-config`, { headers: token ? { "x-keyloom-token": token } : {} });
  }

  test("a found file comes back with its name and text", async () => {
    const get = await serveWith(async () => ({ status: "found", filename: "karabiner.json", content: "{\"profiles\":[]}" }));
    const response = await get();
    expect(response.status).toBe(200);
    expect(KarabinerConfigResponseSchema.parse(await response.json())).toEqual({ filename: "karabiner.json", content: "{\"profiles\":[]}" });
  });

  test("each way it can't be read has its own code", async () => {
    const code = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;
    const missing = await (await serveWith(async () => ({ status: "missing" })))();
    expect([missing.status, await code(missing)]).toEqual([404, "karabiner_missing"]);
    const large = await (await serveWith(async () => ({ status: "too_large" })))();
    expect([large.status, await code(large)]).toEqual([413, "karabiner_too_large"]);
    const denied = await (await serveWith(async () => ({ status: "denied" })))();
    expect([denied.status, await code(denied)]).toEqual([403, "karabiner_denied"]);
    const notAFile = await (await serveWith(async () => ({ status: "not_a_file" })))();
    expect([notAFile.status, await code(notAFile)]).toEqual([422, "karabiner_not_a_file"]);
    const unavailable = await (await serveWith(undefined))();
    expect([unavailable.status, await code(unavailable)]).toEqual([404, "karabiner_unavailable"]);
  });

  test("it needs the session token like every route", async () => {
    const get = await serveWith(async () => ({ status: "missing" }));
    expect((await get(null)).status).toBe(401);
  });
});
