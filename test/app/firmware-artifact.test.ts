// A build's firmware file for a board keyloom can't flash (D-490): only the file the build row names, inside the
// artifacts folder, is served or revealed. The reveal is injected, so Finder never opens.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { NotFoundError, UsageError, buildArtifact, revealBuildArtifact } from "../../src/app/index.ts";
import { createBuild, finishBuild, newBuildId } from "../../src/persistence/builds.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";
import { SLOW_RUNNER_MS } from "../helpers/timeouts.ts";

const fixtures: Awaited<ReturnType<typeof toolchainEnv>>[] = [];
afterEach(() => {
  for (const fixture of fixtures) fixture.closeApp();
  fixtures.length = 0;
});

async function withBuild(artifactRel: string | null, write = true) {
  const e = await toolchainEnv();
  fixtures.push(e);
  const id = newBuildId();
  createBuild(e.app.db, { id, revisionId: e.imported.revisionId, layoutId: e.imported.layoutId, boardRevision: "revb", logPath: `logs/build-${id}.log` });
  if (artifactRel === null) finishBuild(e.app.db, id, { error: "the compiler stopped" });
  else {
    if (write) await Bun.write(join(e.dataDir, artifactRel), "firmware");
    finishBuild(e.app.db, id, { artifactPath: artifactRel });
  }
  return { e, id };
}

describe("buildArtifact", () => {
  test("names the board, revision and build in the download name", async () => {
    const { e, id } = await withBuild("artifacts/x.bin");
    expect(buildArtifact(e.app, id)).toEqual({ path: join(e.dataDir, "artifacts/x.bin"), filename: `keyloom-zsa-moonlander-revb-${id}.bin` });
  });

  test("a failed build, an unknown one, a missing file and a path outside artifacts/ are all not found", async () => {
    const failed = await withBuild(null);
    expect(() => buildArtifact(failed.e.app, failed.id)).toThrow(NotFoundError);
    expect(() => buildArtifact(failed.e.app, "bld_nope")).toThrow(NotFoundError);
    const gone = await withBuild("artifacts/gone.bin", false);
    expect(() => buildArtifact(gone.e.app, gone.id)).toThrow(/gone/);
    // A row edited to point elsewhere in the data directory, such as the database itself.
    const outside = await withBuild("artifacts/../keyloom.db", false);
    expect(() => buildArtifact(outside.e.app, outside.id)).toThrow(/outside/);
  }, SLOW_RUNNER_MS);
});

describe("revealBuildArtifact", () => {
  test("opens the build's own file on macOS, and refuses elsewhere", async () => {
    const { e, id } = await withBuild("artifacts/y.bin");
    const opened: string[] = [];
    await revealBuildArtifact(e.app, id, { platform: "darwin", open: async (path) => { opened.push(path); } });
    expect(opened).toEqual([join(e.dataDir, "artifacts/y.bin")]);
    await expect(revealBuildArtifact(e.app, id, { platform: "linux", open: async () => undefined })).rejects.toThrow(UsageError);
  }, SLOW_RUNNER_MS);

  test("never reveals a path outside the artifacts folder", async () => {
    const { e, id } = await withBuild("artifacts/../keyloom.db", false);
    let opened = false;
    await expect(revealBuildArtifact(e.app, id, { platform: "darwin", open: async () => { opened = true; } })).rejects.toThrow(NotFoundError);
    expect(opened).toBe(false);
  });
});
