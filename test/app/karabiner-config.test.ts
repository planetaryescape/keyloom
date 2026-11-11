// R1-24: Karabiner's settings are read from their one fixed place, and a missing or oversized file says so instead of throwing.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { karabinerConfigPath, readKarabinerConfig } from "../../src/app/karabiner-config.ts";

const homes: string[] = [];
afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));
const home = () => {
  const dir = mkdtempSync(join(tmpdir(), "kl-karabiner-"));
  homes.push(dir);
  return dir;
};

describe("reading Karabiner's settings", () => {
  test("found at ~/.config/karabiner/karabiner.json", async () => {
    const dir = home();
    mkdirSync(join(dir, ".config", "karabiner"), { recursive: true });
    writeFileSync(karabinerConfigPath(dir), "{\"profiles\":[]}");
    expect(await readKarabinerConfig(dir)).toEqual({ status: "found", filename: "karabiner.json", content: "{\"profiles\":[]}" });
  });

  test("no file is missing, not an error", async () => {
    expect(await readKarabinerConfig(home())).toEqual({ status: "missing" });
  });

  test("a file far past a real one's size is refused unread", async () => {
    const dir = home();
    mkdirSync(join(dir, ".config", "karabiner"), { recursive: true });
    writeFileSync(karabinerConfigPath(dir), Buffer.alloc(5 * 1024 * 1024 + 1, 32));
    expect(await readKarabinerConfig(dir)).toEqual({ status: "too_large" });
  });
});
