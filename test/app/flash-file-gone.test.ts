// R8-12: a build whose firmware file is gone when a flash starts has its own code, so the page offers Build again, never a Try again that
// flashes the same missing file. The CLI keeps its sentence and its usage exit.
import { expect, spyOn, test } from "bun:test";
import { buildAndWait, startFlash } from "../../src/app/firmware.ts";
import { UsageError } from "../../src/app/errors.ts";
import { BuildFileGoneError } from "../../src/app/firmware-errors.ts";
import { appEditorBackend } from "../../src/cli/editor-backend.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

test("a flash of a build whose file is gone is build_file_gone at the route and a usage error to the CLI", async () => {
  const e = await toolchainEnv();
  await e.run(async () => {
    const build = await buildAndWait(e.app, "synchronized", { boardRevision: "revb" });
    if (build.artifactPath === null) throw new Error("the successful build must have an artifact");
    // The file went between the build and the flash (a cleaned cache, another tool).
    const gone = Bun.file(build.artifactPath);
    gone.exists = async () => false;
    const fileSpy = spyOn(Bun, "file").mockImplementation(() => gone);
    try {
      const direct = await startFlash(e.app, { buildId: build.id }).catch((error: unknown) => error);
      expect(direct).toBeInstanceOf(BuildFileGoneError);
      expect(direct).toBeInstanceOf(UsageError);
      expect((direct as Error).message).toContain("is gone; build it again");
      await expect(appEditorBackend(e.app).startFlash(build.id)).rejects.toMatchObject({ status: 409, code: "build_file_gone" });
    } finally {
      fileSpy.mockRestore();
    }
  });
  e.closeApp();
});
