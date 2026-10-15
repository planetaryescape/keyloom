import { describe, expect, test } from "bun:test";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFresh } from "../../../src/firmware/toolchain/write-fresh.ts";
import { tempDir } from "../../helpers/tmp.ts";

describe("writeFresh", () => {
  test("replaces a file with a new one (a new inode) and leaves no temporary file", async () => {
    const dir = tempDir();
    const path = join(dir, "default.nix");
    writeFileSync(path, "a much longer file than the one that replaces it\n");
    const before = statSync(path).ino;
    await writeFresh(path, "short\n");
    expect(await Bun.file(path).text()).toBe("short\n");
    expect(statSync(path).ino).not.toBe(before);
    expect(readdirSync(dir)).toEqual(["default.nix"]);
  });

  test("creates missing folders and writes bytes", async () => {
    const dir = tempDir();
    await writeFresh(join(dir, "a", "b", "c.bin"), new Uint8Array([1, 2, 3]));
    expect([...new Uint8Array(await Bun.file(join(dir, "a", "b", "c.bin")).arrayBuffer())]).toEqual([1, 2, 3]);
  });

  test("a failed write leaves the old file and no temporary file", async () => {
    const dir = tempDir();
    const path = join(dir, "target");
    await Bun.$`mkdir ${path}`; // renaming a file over a directory fails
    await expect(writeFresh(path, "x")).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["target"]);
  });
});
