// An emulator run (a lab analysis, a board review's tests, `keyloom emulate`) is container work a forced Docker restart would stop, so it
// says what it is for as long as it may run a container, and waits for a restart that is already stopping the engine (D-529).
import { describe, expect, test } from "bun:test";
import { emulateEvents } from "../../src/app/emulate.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { containerWorkRunning, restartDocker } from "../../src/app/toolchain.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

describe("an emulator run and a forced restart", () => {
  test("the run is named while it waits, waits for the restart instead of asking Docker, and is released when it ends", async () => {
    const e = await toolchainEnv();
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    // The restart holds the engine lock while it looks for the engine; nothing here asks a real daemon.
    const restarting = restartDocker({
      force: true, blocker: () => null,
      overrides: { status: async () => ({ ok: true, version: "29" }), detect: async () => (await opened, { kind: "engine", engine: { name: "Colima", command: ["colima", "start"] } }), restartColima: async () => ({ ok: true, version: "29", engine: "Colima", waitedMs: 1 }) },
    });
    const view = getLayout(e.app, e.imported.layoutId);
    const control = new AbortController();
    const run = emulateEvents(e.app, view, [], { boardRevision: "revb", signal: control.signal, work: "a lab analysis" });
    await Bun.sleep(20);
    expect(containerWorkRunning()).toEqual(["a lab analysis"]);
    // Stopped while it waits: it never reached Docker, and it lets go of its name.
    control.abort();
    await expect(run).rejects.toThrow("Stopped waiting for Docker.");
    expect(containerWorkRunning()).toEqual([]);
    open();
    expect(await restarting).toMatchObject({ ok: true });
    expect(await Bun.file(e.vars.FAKE_DOCKER_LOG).exists()).toBe(false);
    e.closeApp();
  });
});
