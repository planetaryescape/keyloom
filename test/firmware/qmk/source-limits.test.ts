import { expect, test } from "bun:test";
import { truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { readOryxSource } from "../../../src/firmware/qmk/source.ts";
import { tempDir } from "../../helpers/tmp.ts";

const zipFile = async (entries: Record<string, Uint8Array>) => {
  const path = join(tempDir(), "layout.zip");
  await Bun.write(path, zipSync(entries));
  return path;
};

test("ZIP import reads only the first keymap folder and its direct source neighbors", async () => {
  const path = await zipFile({
    "chosen/keymap.c": strToU8("// chosen"),
    "chosen/config.h": strToU8("#define TAPPING_TERM 200"),
    "other/keymap.c": strToU8("// other"),
    "other/config.h": strToU8("#define TAPPING_TERM 999"),
    "chosen/nested/rules.mk": strToU8("unrelated"),
  });
  expect(await readOryxSource(path)).toMatchObject({ keymapC: "// chosen", configH: "#define TAPPING_TERM 200" });
  expect((await readOryxSource(path)).rulesMk).toBeUndefined();
});

test("a ZIP with too many entries is rejected instead of importing a partial layout", async () => {
  const entries: Record<string, Uint8Array> = { "chosen/keymap.c": strToU8("// chosen") };
  for (let i = 0; i < 1024; i++) entries[`unrelated/${i}`] = new Uint8Array();
  await expect(readOryxSource(await zipFile(entries))).rejects.toThrow("more than 1024 entries");
});

test("oversized source entries are rejected instead of silently omitted", async () => {
  const path = await zipFile({ "chosen/keymap.c": strToU8("// chosen"), "chosen/config.h": new Uint8Array(8 * 1024 * 1024 + 1) });
  await expect(readOryxSource(path)).rejects.toThrow("larger than 8388608 bytes");
});

test("the sum of declared source bytes is checked before inflation", async () => {
  const entries: Record<string, Uint8Array> = { "chosen/keymap.c": strToU8("// chosen") };
  const block = new Uint8Array(1024 * 1024);
  for (let i = 0; i < 32; i++) entries[`unrelated-${i}/rules.mk`] = block;
  await expect(readOryxSource(await zipFile(entries))).rejects.toThrow("exceeds 33554432 decompressed bytes");
});

test("the CLI compressed ZIP path is bounded too", async () => {
  const path = join(tempDir(), "oversized.zip");
  writeFileSync(path, "");
  truncateSync(path, 8 * 1024 * 1024 + 1);
  await expect(readOryxSource(path)).rejects.toThrow("larger than 8388608 bytes");
});
