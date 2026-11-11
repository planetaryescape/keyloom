// R1-24: Karabiner's settings are read from their one fixed place, and a missing or oversized file says so instead of throwing.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { karabinerConfigPath, readKarabinerConfig } from "../../src/app/karabiner-config.ts";

const homes: string[] = [];
afterAll(() =>
  homes.forEach((home) => {
    // A folder left at 000 by the denied test can't be removed until it is opened up again.
    const folder = join(home, ".config", "karabiner");
    if (existsSync(folder)) chmodSync(folder, 0o755);
    rmSync(home, { recursive: true, force: true });
  }),
);
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

  test("a file macOS won't let keyloom read says so instead of failing as an internal error", async () => {
    const dir = home();
    mkdirSync(join(dir, ".config", "karabiner"), { recursive: true });
    writeFileSync(karabinerConfigPath(dir), "{}");
    chmodSync(karabinerConfigPath(dir), 0o000);
    expect(await readKarabinerConfig(dir)).toEqual({ status: "denied" });
  });

  test("a folder keyloom may not look into is denied, not missing", async () => {
    const dir = home();
    mkdirSync(join(dir, ".config", "karabiner"), { recursive: true });
    writeFileSync(karabinerConfigPath(dir), "{}");
    chmodSync(join(dir, ".config", "karabiner"), 0o000);
    expect(await readKarabinerConfig(dir)).toEqual({ status: "denied" });
  });

  test("a symlink to a FIFO is refused without opening it, so the read can't hang", async () => {
    const dir = home();
    mkdirSync(join(dir, ".config", "karabiner"), { recursive: true });
    const fifo = join(dir, "pipe");
    expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
    symlinkSync(fifo, karabinerConfigPath(dir));
    expect(await readKarabinerConfig(dir)).toEqual({ status: "not_a_file" });
  });

  test("a folder where the file should be is not a file", async () => {
    const dir = home();
    mkdirSync(karabinerConfigPath(dir), { recursive: true });
    expect(await readKarabinerConfig(dir)).toEqual({ status: "not_a_file" });
  });
});
