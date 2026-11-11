// The remapper setup and System Settings routes (src/api/system-remapper.ts, D-492, D-493), over a fake backend: the allowlist
// refuses a pane it doesn't name before the backend is asked, and every route needs the token.
import { afterAll, describe, expect, test } from "bun:test";
import { RemapperSetupResponseSchema, SetupActionResponseSchema, type SettingsPaneName } from "../../src/api/system-remapper.ts";
import { type RemapperSetupBackend, handleRemapperSetupRoute } from "../../src/server/system-remapper-routes.ts";

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => servers.forEach((s) => s.stop(true)));

function serve() {
  const opened: SettingsPaneName[] = [];
  const started: string[] = [];
  const backend: RemapperSetupBackend = {
    status: async () => ({ platform: "darwin", canInstall: true, installing: false, driverVersion: "6.2.0", findings: [{ code: "kanata_missing", name: "kanata", status: "fail", detail: "kanata isn't installed" }] }),
    installKanata: async () => ({ ok: false, code: "no_brew", reason: "Homebrew isn't installed" }),
    startKanata: async (boardId) => (started.push(boardId), { ok: true }),
    openSettings: async (pane) => (opened.push(pane), { ok: true }),
  };
  const server = Bun.serve({ port: 0, fetch: async (r) => (await handleRemapperSetupRoute(r, new URL(r.url), backend, TOKEN)) ?? new Response("not mine", { status: 404 }) });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), ...init.headers } });
  const post = (path: string, body: unknown, token: string | null = TOKEN) => call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, token);
  return { call, post, opened, started };
}

describe("remapper setup routes", () => {
  test("the read returns the findings with their codes", async () => {
    const { call } = serve();
    const res = await call("/api/system/remapper?board=apple%2Fmacbook-ansi");
    expect(res.status).toBe(200);
    expect(RemapperSetupResponseSchema.parse(await res.json()).findings[0]?.code).toBe("kanata_missing");
    expect((await call("/api/system/remapper")).status).toBe(400);
  });

  test("a step that fails comes back as data with its code", async () => {
    const { post } = serve();
    const res = await post("/api/system/remapper/install-kanata", {});
    expect(res.status).toBe(200);
    expect(SetupActionResponseSchema.parse(await res.json())).toEqual({ ok: false, code: "no_brew", reason: "Homebrew isn't installed" });
    expect((await post("/api/system/remapper/install-kanata", { extra: 1 })).status).toBe(400);
  });

  test("start names the board", async () => {
    const { post, started } = serve();
    expect((await post("/api/system/remapper/start", { boardId: "apple/macbook-ansi" })).status).toBe(200);
    expect(started).toEqual(["apple/macbook-ansi"]);
    expect((await post("/api/system/remapper/start", {})).status).toBe(400);
  });

  test("open-settings opens a listed pane and refuses anything else before the backend sees it", async () => {
    const { post, opened } = serve();
    expect((await post("/api/system/open-settings", { pane: "input_monitoring" })).status).toBe(200);
    for (const pane of ["x-apple.systempreferences:com.apple.preference.security", "../../etc", "Input Monitoring", ""]) {
      const res = await post("/api/system/open-settings", { pane });
      expect(res.status).toBe(400);
    }
    expect((await post("/api/system/open-settings", { pane: "accessibility", url: "https://example.com" })).status).toBe(400);
    expect(opened).toEqual(["input_monitoring"]);
  });

  test("the guard: token, JSON and method", async () => {
    const { call, post } = serve();
    expect((await call("/api/system/remapper?board=x", {}, null)).status).toBe(401);
    expect((await post("/api/system/open-settings", { pane: "accessibility" }, null)).status).toBe(401);
    expect((await call("/api/system/open-settings", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("/api/system/open-settings")).status).toBe(405);
    expect((await call("/api/system/other")).status).toBe(404);
  });
});
