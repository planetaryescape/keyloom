// Restart keyloom (R5-15, D-521): only a server the desktop app started restarts itself, and only after its answer is sent.
import { afterAll, describe, expect, test } from "bun:test";
import { RestartInfoSchema, RestartStartedSchema } from "../../src/api/restart.ts";
import { type RestartBackend, handleRestartRoute } from "../../src/server/restart-routes.ts";

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => servers.forEach((s) => s.stop(true)));

function serve(canRestart: boolean) {
  const asked: number[] = [];
  const backend: RestartBackend = { canRestart, command: "keyloom --data-dir /d serve", restart: () => asked.push(Date.now()) };
  const server = Bun.serve({ port: 0, fetch: async (r) => (await handleRestartRoute(r, new URL(r.url).pathname, backend, TOKEN)) ?? new Response("other", { status: 404 }) });
  servers.push(server);
  const call = (init: RequestInit = {}, token: string | null = TOKEN, path = "/api/restart") =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), ...init.headers } });
  const post = (body = "{}") => call({ method: "POST", body, headers: { "content-type": "application/json" } });
  return { call, post, asked };
}

describe("the restart route", () => {
  test("says whether the desktop app restarts this server, and the terminal line", async () => {
    const { call } = serve(true);
    expect(RestartInfoSchema.parse(await (await call()).json())).toEqual({ canRestart: true, command: "keyloom --data-dir /d serve" });
    expect(RestartInfoSchema.parse(await (await serve(false).call()).json())).toMatchObject({ canRestart: false });
  });

  test("a supervised server answers 202, then stops", async () => {
    const { post, asked } = serve(true);
    const res = await post();
    expect(res.status).toBe(202);
    expect(RestartStartedSchema.parse(await res.json())).toEqual({ restarting: true });
    await Bun.sleep(20);
    expect(asked).toHaveLength(1);
  });

  test("a server started in a terminal refuses with its own code and the line to run, and keeps running", async () => {
    const { post, asked } = serve(false);
    const res = await post();
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("restart_unsupervised");
    expect(body.error.message).toContain("keyloom --data-dir /d serve");
    await Bun.sleep(20);
    expect(asked).toHaveLength(0);
  });

  test("the guard, the content type and the body are checked before anything stops", async () => {
    const { call, post, asked } = serve(true);
    expect((await call({}, null)).status).toBe(401);
    expect((await call({ method: "POST", body: "{}", headers: { "content-type": "application/json" } }, "wrong".repeat(9))).status).toBe(401);
    expect((await call({ method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await post('{"now":true}')).status).toBe(400);
    expect((await call({ method: "DELETE" })).status).toBe(405);
    expect((await call({}, TOKEN, "/api/restarts")).status).toBe(404);
    await Bun.sleep(20);
    expect(asked).toHaveLength(0);
  });
});
