// The server's system backend over the app: a second click joins the restart already running, and Cancel reaches the install job.
import { describe, expect, test } from "bun:test";
import { restartDocker } from "../../src/app/toolchain.ts";
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

  test("a forced restart is refused while a build or flash runs, and refused when nothing can say whether one does (R6-09)", async () => {
    const asked: unknown[] = [];
    let stopped = 0;
    const overrides = { status: async () => ({ ok: true as const, version: "28" }), detect: async () => ({ kind: "engine" as const, engine: { name: "Colima", command: ["colima", "start"] } }), restartColima: async () => (stopped++, { ok: true as const, version: "28", engine: "Colima", waitedMs: 1 }) };
    // The real restart with fake engine parts, so the blocker is asked where the restart asks it: inside the lock, before the stop.
    const restart: typeof restartDocker = (opts = {}) => (asked.push(Object.keys(opts).sort()), restartDocker({ ...opts, overrides }));
    let blocker: string | null = "keyloom is running a build, and restarting Docker now would stop it. Restart Docker once that has finished.";
    const guarded = appSystemBackend({}, { restart, restartBlocker: () => blocker });
    expect(await guarded.restartDocker({ force: true })).toMatchObject({ ok: false, code: "build_running", reason: blocker });
    expect(stopped).toBe(0);
    blocker = null;
    expect(await guarded.restartDocker({ force: true })).toMatchObject({ ok: true, engine: "Colima" });
    expect(stopped).toBe(1);
    expect(asked).toEqual([["blocker", "force"], ["blocker", "force"]]);
    expect(await appSystemBackend({}, { restart }).restartDocker({ force: true })).toMatchObject({ ok: false, code: "build_running" });
    expect(asked).toHaveLength(2);
  });

  test("Fix Colima's files hands serve's build check to the fix, and two clicks share one password dialog (D-533)", async () => {
    let fixes = 0;
    const done = Promise.withResolvers<void>();
    const given: Array<(() => string | null) | undefined> = [];
    const fixFiles = async (opts?: { blocker?: () => string | null }) => { fixes += 1; given.push(opts?.blocker); await done.promise; return { ok: false as const, engine: "Colima", code: "cancelled" as const, reason: "You cancelled the password dialog, so Colima's files didn't change." }; };
    const restartBlocker = () => null;
    const backend = appSystemBackend({}, { fixFiles, restartBlocker });
    const first = backend.fixColimaFiles();
    const second = backend.fixColimaFiles();
    done.resolve();
    expect(await first).toEqual({ ok: false, engine: "Colima", code: "cancelled", reason: "You cancelled the password dialog, so Colima's files didn't change." });
    expect(await second).toEqual(await first);
    expect(fixes).toBe(1);
    expect(given).toEqual([restartBlocker]);
    // A server built without the build check refuses it, so no caller can stop a build by leaving the check out.
    expect(await appSystemBackend({}, { fixFiles }).fixColimaFiles()).toMatchObject({ ok: false, code: "build_running" });
    expect(fixes).toBe(1);
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
