// keyloom's log (R8-09, D-541): the server says where it is, and opens it where it can, with a code for each refusal.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogShownSchema, ServerLogSchema } from "../../src/api/server-log.ts";
import { LOG_FILE_ENV, LogShowError, type ServerLog, openLogFile, serverLog, showServerLog } from "../../src/app/server-log.ts";
import { type LogBackend, handleLogRoute } from "../../src/server/log-routes.ts";

const TOKEN = "t".repeat(43);
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => servers.forEach((s) => s.stop(true)));

function serve(log: ServerLog, show: () => Promise<void> = async () => {}) {
  const backend: LogBackend = { log, show };
  const server = Bun.serve({ port: 0, fetch: async (r) => (await handleLogRoute(r, new URL(r.url).pathname, backend, TOKEN)) ?? new Response("other", { status: 404 }) });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), ...init.headers } });
  return { call, post: () => call("/api/log/show", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }) };
}

test("the log is the file the desktop app names, and a terminal when it names none", () => {
  expect(serverLog({ [LOG_FILE_ENV]: "/Users/me/Library/Logs/k/keyloom.log" }, "darwin")).toEqual({ kind: "file", path: "/Users/me/Library/Logs/k/keyloom.log", canShow: true });
  expect(serverLog({ [LOG_FILE_ENV]: "/var/log/keyloom.log" }, "linux")).toEqual({ kind: "file", path: "/var/log/keyloom.log", canShow: false });
  expect(serverLog({}, "darwin")).toEqual({ kind: "terminal" });
  expect(serverLog({ [LOG_FILE_ENV]: "" }, "darwin")).toEqual({ kind: "terminal" });
  // A relative path would follow whatever folder the server runs in.
  expect(serverLog({ [LOG_FILE_ENV]: "keyloom.log" }, "darwin")).toEqual({ kind: "terminal" });
});

test("the desktop shell names the log with the same variable the server reads", () => {
  const sidecar = readFileSync(join(import.meta.dir, "../../desktop/tauri/src-tauri/src/sidecar.rs"), "utf8");
  expect(sidecar).toContain(`const LOG_FILE_ENV: &str = "${LOG_FILE_ENV}";`);
  expect(sidecar).toContain(".envs(crate::log::path(app).map(|file| (LOG_FILE_ENV, file)))");
});

test("Show keyloom's log opens the file, creating it first when the app hasn't written it yet", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "kl-log-")), "Logs", "keyloom.log");
  const opened: string[] = [];
  await showServerLog({ kind: "file", path, canShow: true }, { platform: "darwin", open: async (p) => { opened.push(p); } });
  expect(opened).toEqual([path]);
  expect(existsSync(path)).toBe(true);
});

test("each refusal has its own code and names where the log is", async () => {
  const file = { kind: "file", path: "/tmp/kl/keyloom.log", canShow: true } as const;
  await expect(showServerLog({ kind: "terminal" }, { platform: "darwin" })).rejects.toMatchObject({ code: "log_in_terminal" });
  await expect(showServerLog(file, { platform: "linux" })).rejects.toMatchObject({ code: "log_unsupported", message: expect.stringContaining("/tmp/kl/keyloom.log") });
  const dir = mkdtempSync(join(tmpdir(), "kl-log-"));
  const failed = showServerLog({ ...file, path: join(dir, "keyloom.log") }, { platform: "darwin", open: async () => { throw new Error("no app for .log"); } });
  await expect(failed).rejects.toBeInstanceOf(LogShowError);
  await expect(failed).rejects.toMatchObject({ code: "log_open_failed", message: expect.stringContaining("no app for .log") });
});

test("the route says where the log is, and needs the session token", async () => {
  const { call } = serve({ kind: "file", path: "/l/keyloom.log", canShow: true });
  expect(ServerLogSchema.parse(await (await call("/api/log")).json())).toEqual({ kind: "file", path: "/l/keyloom.log", canShow: true });
  expect((await call("/api/log", {}, null)).status).toBe(401);
  expect(ServerLogSchema.parse(await (await serve({ kind: "terminal" }).call("/api/log")).json())).toEqual({ kind: "terminal" });
});

test("the route opens the log, and answers each refusal with its code", async () => {
  let shown = 0;
  const ok = await serve({ kind: "file", path: "/l/keyloom.log", canShow: true }, async () => { shown++; }).post();
  expect(ok.status).toBe(200);
  expect(LogShownSchema.parse(await ok.json())).toEqual({ shown: true });
  expect(shown).toBe(1);
  const terminal = await serve({ kind: "terminal" }, () => showServerLog({ kind: "terminal" })).post();
  expect(terminal.status).toBe(409);
  expect(await terminal.json()).toMatchObject({ error: { code: "log_in_terminal" } });
  const failed = await serve({ kind: "file", path: "/l/keyloom.log", canShow: true }, async () => { throw new LogShowError("log_open_failed", "no"); }).post();
  expect(failed.status).toBe(500);
  expect(await failed.json()).toMatchObject({ error: { code: "log_open_failed", message: "no" } });
  const { call } = serve({ kind: "terminal" });
  expect((await call("/api/log/show", { method: "POST", body: "{}" })).status).toBe(415);
  expect((await call("/api/log/show")).status).toBe(405);
});

const ran = (exitCode: number, stderr = "") => ({ exitCode, signalCode: null, timedOut: false, aborted: false, durationMs: 1, stdout: "", stderr });

test("Show keyloom's log runs macOS open by its absolute path, so another open on the PATH never runs", async () => {
  const cmds: string[][] = [];
  await openLogFile("/Users/me/Library/Logs/k/keyloom.log", async (cmd) => { cmds.push(cmd); return ran(0); });
  expect(cmds).toEqual([["/usr/bin/open", "/Users/me/Library/Logs/k/keyloom.log"]]);
  await expect(openLogFile("/x.log", async () => ran(1, "The file /x.log does not exist.\n"))).rejects.toThrow("The file /x.log does not exist.");
});
