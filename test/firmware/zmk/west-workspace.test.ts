import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withWestWorkspace, lockedWestManifest, westInputsKey, westProjects } from "../../../src/firmware/zmk/west-workspace.ts";
import inputs from "../../../src/firmware/zmk/west-inputs.json" with { type: "json" };
import { fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { FAKE_WEST_GIT, seedWestSources } from "../../helpers/west-sources.ts";
import { tempDir } from "../../helpers/tmp.ts";

const prepareWestWorkspace = (workspace: string, projects: Parameters<typeof withWestWorkspace>[1], image: string) =>
  withWestWorkspace(workspace, projects, image, {}, async () => undefined);

const repo = "https://github.com/zmkfirmware/zmk";

test("every transitive west input is immutable and manifests contain no imports", () => {
  const projects = westProjects(repo, inputs.zmkSha);
  expect(projects).toHaveLength(39);
  for (const p of projects) expect(p.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(projects.find((p) => p.name === "zephyr")?.revision).toBe("dacab4875df72109b96cc8977547a0dc04875bcd");
  expect(projects.find((p) => p.name === "nanopb")?.url).toBe("https://github.com/zmkfirmware/nanopb");
  expect(lockedWestManifest(projects)).not.toContain('"import"');
  expect(() => westProjects(repo, "a".repeat(40))).toThrow(/no reviewed dependency lock/);
});

test("resolved transitive source, repository, board modules, and image change the cache identity", () => {
  const projects = westProjects(repo, inputs.zmkSha);
  const key = westInputsKey(projects, "image@sha256:one");
  expect(westInputsKey(projects, "image@sha256:two")).not.toBe(key);
  expect(westInputsKey(westProjects("https://example.com/fork", inputs.zmkSha), "image@sha256:one")).not.toBe(key);
  expect(westInputsKey(projects.map((p) => p.name === "zephyr" ? { ...p, revision: "a".repeat(40) } : p), "image@sha256:one")).not.toBe(key);
  expect(westInputsKey(westProjects(repo, inputs.zmkSha, { boardModule: { repo: "https://example.com/module", sha: "a".repeat(40) } }), "image@sha256:one")).not.toBe(key);
});

test("workspace metadata and output never survive reuse, and every source mount is read-only", async () => {
  const workspace = join(tempDir(), "work");
  const projects = westProjects(repo, inputs.zmkSha);
  await seedWestSources(workspace, projects, "image");
  const bin = fakeBinDir({ git: FAKE_WEST_GIT });
  await withPath(bin, async () => {
    const mounts = await withWestWorkspace(workspace, projects, "image", {}, async (dir, mounts) => {
      expect(dir).not.toBe(workspace);
      return mounts;
    });
    expect(mounts.filter((m) => m === "--mount")).toHaveLength(projects.length);
    for (const mount of mounts.filter((m) => m !== "--mount")) {
      expect(mount).toEndWith(",readonly");
      expect(mount).not.toContain(`src=${workspace}/`);
    }
    await Bun.write(join(workspace, ".west", "config"), "contaminated manifest configuration");
    await Bun.write(join(workspace, "build", "left", "zephyr", "zmk.uf2"), "stale firmware");
    await prepareWestWorkspace(workspace, projects, "image");
    expect(existsSync(join(workspace, ".west"))).toBe(false);
    expect(existsSync(join(workspace, "build"))).toBe(false);
  });
});
