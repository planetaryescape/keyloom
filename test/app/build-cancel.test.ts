// Cancel build (R3-10): a Cancel stops the build's container and removes it, ends the build as stopped, and never starts a flash.
// Fake docker only; nothing here builds or flashes for real.
import { describe, expect, test } from "bun:test";
import { BuildNotCancellableError, NotFoundError, cancelBuild, getBuild, startBuild } from "../../src/app/index.ts";
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
      const stopped = await cancelBuild(e.app, started.id);
      expect(stopped).toMatchObject({ status: "failed", error: "Build stopped.", errorCode: "cancelled", artifactPath: null });
      expect(await Bun.file(e.vars.FAKE_DOCKER_LOG).text()).toContain(`rm -f keyloom-${started.id}`);
      expect(e.app.db.query("SELECT COUNT(*) AS n FROM flashes").get()).toEqual({ n: 0 });
      // A second Cancel finds nothing to stop.
      await expect(cancelBuild(e.app, started.id)).rejects.toThrow(BuildNotCancellableError);
    }, { FAKE_MODE: "hang" });
    e.closeApp();
  });

  test("an unknown build is not found", async () => {
    const e = await toolchainEnv();
    await expect(cancelBuild(e.app, "bld_nope")).rejects.toThrow(NotFoundError);
    e.closeApp();
  });

  test("the route answers with the stopped build, and 409 build_finished once it has ended", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const backend = appEditorBackend(e.app);
      const started = await startBuild(e.app, "synchronized", { boardRevision: "revb" });
      await until(() => getBuild(e.app, started.id), (b) => b.logTail.some((line) => line.includes("started")));
      const post = () => new Request(`http://127.0.0.1/api/builds/${started.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const first = await handleEditorRoute(post(), `/api/builds/${started.id}/cancel`, backend);
      expect(first?.status).toBe(200);
      expect(await first?.json()).toMatchObject({ id: started.id, status: "failed", errorCode: "cancelled" });
      const again = await handleEditorRoute(post(), `/api/builds/${started.id}/cancel`, backend);
      expect(again?.status).toBe(409);
      expect(await again?.json()).toMatchObject({ error: { code: "build_finished" } });
    }, { FAKE_MODE: "hang" });
    e.closeApp();
  });
});
