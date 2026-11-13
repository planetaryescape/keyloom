// `keyloom doctor --download kanata|zapp` (D-030 parity with Get kanata and Get Zapp, D-560 and D-561): the same download, with its lines
// in the terminal. Every fetcher is a fake, and every folder a scratch one.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { downloadToolWithProgress } from "../../src/cli/download-tool.ts";
import { serving, testPins, zappTar } from "../helpers/tool-download.ts";
import { tempDir } from "../helpers/tmp.ts";

const mac = { platform: "darwin" as const, arch: "arm64", pins: testPins(), inUse: () => undefined };

describe("downloadToolWithProgress", () => {
  test("downloads, checks and keeps the tool, saying each step", async () => {
    const dir = tempDir("keyloom-kept-");
    const lines: string[] = [];
    const out = await downloadToolWithProgress("zapp", (l) => lines.push(l), { ...mac, dir, fetch: serving(zappTar).fetch });
    expect(out).toEqual({ ok: true, path: join(dir, "zapp") });
    expect(lines[0]).toBe("keyloom: downloading Zapp 1.0.2 from https://github.com/zsa/zapp/releases/download/v1.0.2/z.tar.gz");
    expect(lines.at(-1)).toBe(`keyloom: kept Zapp 1.0.2 in ${dir}`);
  });

  test("a tool that is already here is not downloaded again: keyloom's copy would never be the one used", async () => {
    const { fetch, asked } = serving(zappTar);
    const lines: string[] = [];
    const out = await downloadToolWithProgress("zapp", (l) => lines.push(l), { ...mac, dir: tempDir("keyloom-kept-"), fetch, inUse: () => "/opt/homebrew/bin/zapp" });
    expect(out).toMatchObject({ ok: true, already: true });
    expect(lines).toEqual(["keyloom: zapp is already at /opt/homebrew/bin/zapp, so nothing was downloaded"]);
    expect(asked).toEqual([]);
  });

  test("a mismatch prints its reason and keeps nothing", async () => {
    const dir = tempDir("keyloom-kept-");
    const lines: string[] = [];
    const out = await downloadToolWithProgress("zapp", (l) => lines.push(l), { ...mac, dir, fetch: serving(new Uint8Array([1])).fetch });
    expect(out).toMatchObject({ ok: false, code: "checksum_mismatch" });
    expect(lines.at(-1)).toStartWith("keyloom: The file keyloom downloaded isn't Zapp 1.0.2 as released");
    expect(readdirSync(dir)).toEqual([]);
  });
});
