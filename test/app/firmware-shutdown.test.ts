import { expect, spyOn, test } from "bun:test";
import { buildAndWait, drainManualFlashTasks, startFlash } from "../../src/app/firmware.ts";
import { drainDeviceConsumers } from "../../src/app/device-connections.ts";
import { UsageError } from "../../src/app/errors.ts";
import { appEditorBackend } from "../../src/cli/editor-backend.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

function delayArtifactCheck(artifact: string | null) {
  if (artifact === null) throw new Error("the successful build must have an artifact");
  const gate = Promise.withResolvers<boolean>();
  const file = Bun.file(artifact);
  file.exists = () => gate.promise;
  const fileSpy = spyOn(Bun, "file").mockImplementationOnce((path) => {
    expect(path).toBe(artifact);
    return file;
  });
  return { ...gate, restore: () => fileSpy.mockRestore() };
}

test("shutdown waits for an accepted flash still checking its artifact and for its final callback", async () => {
  const e = await toolchainEnv();
  await e.run(async () => {
    const build = await buildAndWait(e.app, "synchronized", { boardRevision: "revb" });
    const artifactCheck = delayArtifactCheck(build.artifactPath);
    const flashFinished = Promise.withResolvers<void>();
    const allowFlashTaskToFinish = Promise.withResolvers<void>();
    let helperClosed = false;
    const starting = startFlash(e.app, {
      buildId: build.id,
      onState: async (flash) => {
        if (flash.status === "succeeded") {
          flashFinished.resolve();
          await allowFlashTaskToFinish.promise;
        }
      },
    });
    const draining = drainDeviceConsumers([drainManualFlashTasks(e.app)], async () => { helperClosed = true; });
    try {
      await Bun.sleep(10);
      expect(helperClosed).toBe(false);
      artifactCheck.resolve(true);
      const flash = await starting;
      expect(flash.buildId).toBe(build.id);
      await flashFinished.promise;
      await Bun.sleep(10);
      expect(helperClosed).toBe(false);
      allowFlashTaskToFinish.resolve();
      await draining;
      expect(helperClosed).toBe(true);
    } finally {
      artifactCheck.resolve(true);
      allowFlashTaskToFinish.resolve();
      await Promise.allSettled([starting, draining]);
      artifactCheck.restore();
    }
  });
  e.closeApp();
});

test("shutdown refuses new manual flashes with the existing usage route error", async () => {
  const e = await toolchainEnv();
  const draining = drainManualFlashTasks(e.app);
  await expect(startFlash(e.app, {})).rejects.toThrow(UsageError);
  await expect(appEditorBackend(e.app).startFlash("bld_unused")).rejects.toMatchObject({
    status: 400, code: "usage", message: "keyloom is shutting down; no new flashes can start",
  });
  await draining;
  await expect(startFlash(e.app, {})).rejects.toThrow(/shutting down/);
  await drainManualFlashTasks(e.app);
  // Another App in the same process isn't shutting down.
  const other = await toolchainEnv();
  await expect(startFlash(other.app, { buildId: "bld_missing" })).rejects.toThrow(/no build/);
  other.closeApp();
  e.closeApp();
});

for (const outcome of ["throws", "missing"] as const) {
  test(`shutdown releases a pending start when its artifact check ${outcome}`, async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const build = await buildAndWait(e.app, "synchronized", { boardRevision: "revb" });
      const artifactCheck = delayArtifactCheck(build.artifactPath);
      const failure = new Error("synthetic artifact read failure");
      const starting = startFlash(e.app, { buildId: build.id });
      const rejected = starting.then(() => { throw new Error("the artifact check must refuse this start"); }, (error) => {
        if (outcome === "throws") expect(error).toBe(failure);
        else expect(error).toMatchObject({ name: "UsageError", message: expect.stringContaining("is gone; build it again") });
      });
      let drained = false;
      const draining = drainManualFlashTasks(e.app).then(() => { drained = true; });
      try {
        await Bun.sleep(10);
        expect(drained).toBe(false);
        if (outcome === "throws") artifactCheck.reject(failure);
        else artifactCheck.resolve(false);
        await rejected;
        await draining;
        expect(drained).toBe(true);
        await drainManualFlashTasks(e.app);
      } finally {
        artifactCheck.resolve(false);
        await Promise.allSettled([starting, draining]);
        artifactCheck.restore();
      }
    });
    e.closeApp();
  });
}

test("shutdown releases a start refused before the artifact check", async () => {
  const e = await toolchainEnv();
  await expect(startFlash(e.app, { buildId: "bld_missing" })).rejects.toThrow(/no build/);
  await drainManualFlashTasks(e.app);
  e.closeApp();
});
