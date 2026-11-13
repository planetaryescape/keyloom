import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withWorkspace } from "../../../src/firmware/toolchain/workspace.ts";
import { tempDir } from "../../helpers/tmp.ts";

test("each run has a new mount path and never consumes the previous debug snapshot", async () => {
  const base = join(tempDir(), "board");
  await Bun.write(join(base, "source"), "poisoned old source");
  const paths: string[] = [];
  for (const contents of ["first approved source", "second approved source"]) {
    await withWorkspace(base, async (dir) => {
      paths.push(dir);
      expect(dir).not.toBe(base);
      expect(existsSync(join(dir, "source"))).toBe(false);
      await Bun.write(join(dir, "source"), contents);
      // A container using the old stable bind can change only that snapshot.
      await Bun.write(join(base, "source"), "orphan write");
      expect(await Bun.file(join(dir, "source")).text()).toBe(contents);
    });
    expect(await Bun.file(join(base, "source")).text()).toBe(contents);
  }
  expect(paths[0]).not.toBe(paths[1]);
});

test("a failed run keeps its debug files without feeding them into its retry", async () => {
  const base = join(tempDir(), "board");
  await expect(withWorkspace(base, async (dir) => {
    await Bun.write(join(dir, "source"), "failed run");
    throw new Error("compile failed");
  })).rejects.toThrow("compile failed");
  expect(await Bun.file(join(base, "source")).text()).toBe("failed run");
  await withWorkspace(base, async (dir) => {
    expect(existsSync(join(dir, "source"))).toBe(false);
  });
});
