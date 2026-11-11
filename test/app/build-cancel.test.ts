// Cancel build (R3-10): a Cancel stops the build's container and removes it, ends the build as stopped, and never starts a flash.
// Fake docker only; nothing here builds or flashes for real.
import { describe, expect, test } from "bun:test";
import { BuildNotCancellableError, NotFoundError, cancelBuild, getBuild, startBuild, waitForBuild } from "../../src/app/index.ts";
import { showBoard } from "../../src/app/boards.ts";
import { checkoutDirFor } from "../../src/app/firmware.ts";
import { appEditorBackend } from "../../src/cli/editor-backend.ts";
import { handleEditorRoute } from "../../src/server/editor-routes.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

async function until<T>(fn: () => Promise<T>, done: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (done(v) || Date.now() > end) return v;
    await Bun.sleep(25);
  }
}

describe("cancelBuild", () => {
  test("stops a running build, removes its container, and ends it as stopped with no flash", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const started = await startBuild(e.app, "synchronized", { boardRevision: "revb" });
      // The container is running: the fake docker printed "started" and now sleeps.
      await until(() => getBuild(e.app, started.id), (b) => b.logTail.some((line) => line.includes("started")));
      // The cancel answers at once; the build then ends as stopped, which a poll sees.
      expect(await cancelBuild(e.app, started.id)).toMatchObject({ id: started.id, status: "running" });
      const stopped = await waitForBuild(e.app, started.id);
      expect(stopped).toMatchObject({ status: "failed", error: "Build stopped.", errorCode: "cancelled", artifactPath: null });
      expect(await Bun.file(e.vars.FAKE_DOCKER_LOG).text()).toContain(`rm -f keyloom-${started.id}`);
      expect(e.app.db.query("SELECT COUNT(*) AS n FROM flashes").get()).toEqual({ n: 0 });
      // A second Cancel finds nothing to stop.
      await expect(cancelBuild(e.app, started.id)).rejects.toThrow(BuildNotCancellableError);
    }, { FAKE_MODE: "hang" });
    e.closeApp();
  });

  test("a build queued behind another build's checkout lock stops at once, not when that lock is let go (#285 review)", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      // Another keyloom (a live pid) holds the checkout for as long as this test runs.
      const lock = `${await checkoutDirFor(showBoard("zsa/moonlander"))}.lock`;
      await Bun.$`mkdir -p ${lock}`;
      await Bun.write(`${lock}/pid`, String(process.ppid));
      const started = await startBuild(e.app, "synchronized", { boardRevision: "revb" });
      await until(() => getBuild(e.app, started.id), (b) => b.logTail.some((line) => line.includes("waiting for another build")));
      await cancelBuild(e.app, started.id);
      const stopped = await Promise.race([waitForBuild(e.app, started.id), Bun.sleep(3_000).then(() => null)]);
      expect(stopped).toMatchObject({ status: "failed", errorCode: "cancelled" });
      expect(await Bun.file(`${lock}/pid`).text()).toBe(String(process.ppid));
      await Bun.$`rm -rf ${lock}`;
    });
    e.closeApp();
  });

  test("an unknown build is not found", async () => {
    const e = await toolchainEnv();
    await expect(cancelBuild(e.app, "bld_nope")).rejects.toThrow(NotFoundError);
    e.closeApp();
  });

  test("the route answers 202 at once, before the build has stopped, and 409 build_finished once it has ended (#285 review)", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const backend = appEditorBackend(e.app);
      const started = await startBuild(e.app, "synchronized", { boardRevision: "revb" });
      await until(() => getBuild(e.app, started.id), (b) => b.logTail.some((line) => line.includes("started")));
      const post = () => new Request(`http://127.0.0.1/api/builds/${started.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const first = await handleEditorRoute(post(), `/api/builds/${started.id}/cancel`, backend);
      expect(first?.status).toBe(202);
      expect(await first?.json()).toMatchObject({ id: started.id, status: "running" });
      expect(await waitForBuild(e.app, started.id)).toMatchObject({ status: "failed", errorCode: "cancelled" });
      const again = await handleEditorRoute(post(), `/api/builds/${started.id}/cancel`, backend);
      expect(again?.status).toBe(409);
      expect(await again?.json()).toMatchObject({ error: { code: "build_finished" } });
    }, { FAKE_MODE: "hang" });
    e.closeApp();
  });
});
