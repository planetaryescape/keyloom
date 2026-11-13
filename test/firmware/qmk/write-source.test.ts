import { expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QmkDockerBuildSchema } from "../../../src/boards/recipes.ts";
import { workspacePath } from "../../../src/firmware/toolchain/workspace-path.ts";
import { writeSource } from "../../../src/firmware/qmk/write-source.ts";
import { tempDir } from "../../helpers/tmp.ts";

const source = { keymapName: "keyloom", files: [{ path: "keymap.c", content: "// synthetic\n" }] };

for (const path of ["../victim", "a/../../victim", "/tmp/victim", "C:/victim", "a\\..\\victim", "a/./keymaps", "a//keymaps", "a/..", "a\0b"]) {
  test(`board recipes refuse unsafe keymap path ${JSON.stringify(path)}`, () => {
    const result = QmkDockerBuildSchema.shape.keymapsDir.safeParse(path);
    expect(result.success).toBe(false);
  });
}

test("nested keymap directory replaces stale source inside its workspace", async () => {
  const root = tempDir();
  const dir = join(root, "keyboards", "board", "keymaps", "keyloom");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stale.c"), "old");
  await writeSource(dir, source, { clean: true, root });
  expect(existsSync(join(dir, "stale.c"))).toBe(false);
  expect(await Bun.file(join(dir, "keymap.c")).text()).toBe("// synthetic\n");
});

test("cleanup outside the workspace preserves synthetic victim data", async () => {
  const parent = tempDir();
  const root = join(parent, "checkout");
  const victim = join(parent, "victim");
  mkdirSync(root); mkdirSync(victim);
  writeFileSync(join(victim, "data"), "keep");
  await expect(writeSource(victim, source, { clean: true, root })).rejects.toThrow("Unsafe build workspace path");
  expect(await Bun.file(join(victim, "data")).text()).toBe("keep");
});

test("symlinked keymap parent cannot redirect host cleanup", async () => {
  const root = tempDir();
  const victim = tempDir();
  const dir = join(victim, "keyloom");
  mkdirSync(dir); writeFileSync(join(dir, "data"), "keep");
  symlinkSync(victim, join(root, "keymaps"));
  await expect(writeSource(join(root, "keymaps", "keyloom"), source, { clean: true, root })).rejects.toThrow("symlink");
  expect(await Bun.file(join(dir, "data")).text()).toBe("keep");
});

test("generated filenames cannot traverse or follow a symlink out of their directory", async () => {
  const root = tempDir();
  const victim = tempDir();
  writeFileSync(join(victim, "data"), "keep");
  symlinkSync(victim, join(root, "linked"));
  for (const path of ["../data", join(victim, "data"), "linked/data"]) {
    await expect(writeSource(root, { ...source, files: [{ path, content: "replace" }] })).rejects.toThrow();
  }
  expect(await Bun.file(join(victim, "data")).text()).toBe("keep");
});

test("a symlink used to name the workspace itself resolves without allowing symlinks within it", async () => {
  const parent = tempDir();
  const root = tempDir();
  symlinkSync(root, join(parent, "workspace"));
  expect(await workspacePath(join(parent, "workspace"), "keymaps/keyloom")).toBe(join(parent, "workspace", "keymaps", "keyloom"));
});
