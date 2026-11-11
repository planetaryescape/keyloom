// The server's system backend over the app: a second click joins the restart already running, and Cancel reaches the install job.
import { describe, expect, test } from "bun:test";
import type { InstallRunner } from "../../src/app/tool-install.ts";
import { appSystemBackend } from "../../src/cli/system-backend.ts";

describe("appSystemBackend", () => {
  test("two restart clicks share one quit and reopen (R2-07)", async () => {
    let restarts = 0;
    const done = Promise.withResolvers<void>();
    const backend = appSystemBackend({}, { restart: async () => { restarts += 1; await done.promise; return { ok: true, version: "28", engine: "OrbStack", waitedMs: 1 }; } });
    const first = backend.restartDocker();
    const second = backend.restartDocker();
    done.resolve();
    expect(await first).toEqual({ ok: true, version: "28", engine: "OrbStack", waitedMs: 1 });
    expect(await second).toEqual(await first);
    expect(restarts).toBe(1);
  });

  test("a failed Colima start reaches the page without its terminal hint, which the Restart button replaces; others keep theirs (R3-04)", async () => {
    const hint = "if it fails, run `colima restart` in a terminal and build again";
    const colima = appSystemBackend({}, { start: async () => ({ ok: false, engine: "Colima", reason: "keyloom couldn't start Colima: exit status 1", hint, restartEngine: "Colima" }) });
    expect(await colima.startDocker()).toEqual({ ok: false, engine: "Colima", reason: "keyloom couldn't start Colima: exit status 1" });
    const service = appSystemBackend({}, { start: async () => ({ ok: false, engine: "the Docker service", reason: "keyloom couldn't start the Docker service: permission denied", hint: "if it asked for a password, run `sudo systemctl start docker`" }) });
    expect(await service.startDocker()).toMatchObject({ reason: "keyloom couldn't start the Docker service: permission denied. if it asked for a password, run `sudo systemctl start docker`" });
  });

  test("a failed restart reaches the page without the terminal hint: the page offers Colima's guide, not a terminal (#285 review)", async () => {
    const hint = "if it fails, run `colima restart` in a terminal and build again";
    const backend = appSystemBackend({}, { restart: async () => ({ ok: false, engine: "Colima", reason: "keyloom couldn't start Colima: exit status 1", hint }) });
    expect(await backend.restartDocker()).toEqual({ ok: false, engine: "Colima", reason: "keyloom couldn't start Colima: exit status 1" });
  });

  test("a restart refused because keyloom is already starting Docker carries engine_busy to the page (R4-04)", async () => {
    const backend = appSystemBackend({}, { restart: async () => ({ ok: false, engine: null, code: "engine_busy" as const, reason: "keyloom is already starting Docker, for this page or for a build. Wait for that to finish, then check again." }) });
    expect(await backend.restartDocker()).toMatchObject({ ok: false, code: "engine_busy" });
  });

  test("stopInstalls, which serve's shutdown runs, ends a running install (#277 review)", async () => {
    const runner: InstallRunner = (_cmd, opts) => new Promise((resolve) => opts.signal?.addEventListener("abort", () => resolve({ exitCode: null, timedOut: false }), { once: true }));
    const backend = appSystemBackend({ platform: "darwin", has: (c) => c === "brew", runner });
    await backend.install("zapp");
    await backend.stopInstalls();
    expect(await backend.installState("zapp")).toMatchObject({ status: "cancelled" });
  });

  test("Cancel stops the install the page started (R2-08)", async () => {
    const runner: InstallRunner = (_cmd, opts) => new Promise((resolve) => opts.signal?.addEventListener("abort", () => resolve({ exitCode: null, timedOut: false }), { once: true }));
    const backend = appSystemBackend({ platform: "darwin", has: (c) => c === "brew", runner });
    await backend.install("zapp");
    expect(await backend.cancelInstall("zapp")).toMatchObject({ status: "running", phase: "stopping" });
    await Bun.sleep(5);
    expect(await backend.installState("zapp")).toMatchObject({ status: "cancelled" });
  });
});
