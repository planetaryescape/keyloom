// Getting kanata and Zapp without Homebrew (D-560, D-561). Every download here goes through a fake fetcher that serves archives the test
// builds itself, into a scratch folder, so no test reaches GitHub or the person's own folder. The one exception is the opt-in check of the
// real pins at the end (KEYLOOM_DOWNLOAD_TESTS=1), which downloads into a scratch folder.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { CMD_ALLOWED, KANATA, ZAPP, kanataZip, serving, testPins, zappTar } from "../helpers/tool-download.ts";
import { showBoard } from "../../src/app/boards.ts";
import { type Fetcher, PINNED_TOOLS, type PinnedTool, canDownload, downloadTool, pinnedAsset } from "../../src/app/tool-download.ts";
import { kanataRevision } from "../../src/firmware/kanata/board-config.ts";
import { findKanata } from "../../src/firmware/kanata/binary.ts";
import { keptTool, keptToolsDir } from "../../src/firmware/toolchain/kept-tools.ts";

const scratch = (): string => mkdtempSync(join(tmpdir(), "keyloom-tools-"));
const pins = testPins;

const mac = { platform: "darwin" as const, arch: "arm64" };

describe("downloadTool", () => {
  test("kanata: downloads the pinned zip, takes the plain build out of it, checks both hashes and keeps it, mode 755", async () => {
    const dir = scratch();
    const { fetch, asked } = serving(kanataZip);
    const lines: string[] = [];
    const out = await downloadTool("kanata", (l) => lines.push(l), { ...mac, fetch, dir, pins: pins() });
    expect(out).toEqual({ ok: true, path: join(dir, "kanata") });
    expect(asked).toEqual(["https://github.com/jtroo/kanata/releases/download/v1.12.0/k.zip"]);
    // The build that can run programs is never the one kept (D-498).
    expect(new Uint8Array(readFileSync(join(dir, "kanata")))).toEqual(KANATA);
    expect(statSync(join(dir, "kanata")).mode & 0o777).toBe(0o755);
    expect(readdirSync(dir)).toEqual(["kanata"]);
    expect(lines[0]).toBe("keyloom: downloading kanata 1.12.0 from https://github.com/jtroo/kanata/releases/download/v1.12.0/k.zip");
    expect(lines).toContain("keyloom: the SHA-256 matches the release");
    expect(lines.at(-1)).toBe(`keyloom: kept kanata 1.12.0 in ${dir}`);
  });

  test("Zapp: the same from its tar.gz, into a folder that doesn't exist yet", async () => {
    const dir = join(scratch(), "keyloom", "bin");
    const out = await downloadTool("zapp", () => undefined, { ...mac, fetch: serving(zappTar).fetch, dir, pins: pins() });
    expect(out).toEqual({ ok: true, path: join(dir, "zapp") });
    expect(new Uint8Array(readFileSync(join(dir, "zapp")))).toEqual(ZAPP);
  });

  test("a download whose checksum doesn't match is refused, and nothing is written", async () => {
    const dir = scratch();
    const tampered = zipSync({ kanata_macos_arm64: CMD_ALLOWED });
    const out = await downloadTool("kanata", () => undefined, { ...mac, fetch: serving(tampered).fetch, dir, pins: pins() });
    expect(out).toMatchObject({ ok: false, code: "checksum_mismatch" });
    expect(out.ok ? "" : out.reason).toBe("The file keyloom downloaded isn't kanata 1.12.0 as released: its checksum doesn't match. keyloom kept none of it. Try again, and if it happens again, get kanata from its release page.");
    expect(readdirSync(dir)).toEqual([]);
  });

  test("an archive that matches but holds a program with another hash is refused too", async () => {
    const dir = scratch();
    const out = await downloadTool("kanata", () => undefined, { ...mac, fetch: serving(kanataZip).fetch, dir, pins: pins({ binary: CMD_ALLOWED }) });
    expect(out).toMatchObject({ ok: false, code: "checksum_mismatch" });
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a body larger than the release file stops at its size and is refused", async () => {
    const dir = scratch();
    const longer = new Uint8Array(kanataZip.byteLength + 1);
    longer.set(kanataZip);
    const out = await downloadTool("kanata", () => undefined, { ...mac, fetch: serving(longer).fetch, dir, pins: pins() });
    expect(out).toMatchObject({ ok: false, code: "checksum_mismatch" });
    expect(readdirSync(dir)).toEqual([]);
  });

  test("GitHub's error answer, a lost connection and a redirect off HTTPS are download_failed, with nothing written", async () => {
    const dir = scratch();
    const notFound = await downloadTool("kanata", () => undefined, { ...mac, fetch: serving(new Uint8Array(), { status: 404 }).fetch, dir, pins: pins() });
    expect(notFound).toEqual({ ok: false, code: "download_failed", reason: "keyloom couldn't download kanata: GitHub answered 404. Check that this computer is online, then try again." });
    const offline = await downloadTool("kanata", () => undefined, { ...mac, fetch: async () => { throw new Error("Unable to connect"); }, dir, pins: pins() });
    expect(offline).toMatchObject({ ok: false, code: "download_failed", reason: "keyloom couldn't download kanata: Unable to connect. Check that this computer is online, then try again." });
    const plainHttp = await downloadTool("kanata", () => undefined, { ...mac, fetch: serving(kanataZip, { url: "http://example.com/k.zip" }).fetch, dir, pins: pins() });
    expect(plainHttp).toMatchObject({ ok: false, code: "download_failed" });
    expect(readdirSync(dir)).toEqual([]);
  });

  test("Cancel stops the download and keeps nothing", async () => {
    const dir = scratch();
    const controller = new AbortController();
    const fetch: Fetcher = async (_url, init) => {
      controller.abort();
      throw init.signal?.reason ?? new Error("aborted");
    };
    const out = await downloadTool("kanata", () => undefined, { ...mac, fetch, dir, pins: pins() }, controller.signal);
    expect(out).toEqual({ ok: false, code: "cancelled", reason: "You cancelled the download. keyloom kept nothing." });
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a folder keyloom can't write is write_failed, and leaves no half-written file", async () => {
    const parent = scratch();
    // A file where the folder should be: mkdir fails.
    await Bun.write(join(parent, "bin"), "not a folder");
    const out = await downloadTool("kanata", () => undefined, { ...mac, fetch: serving(kanataZip).fetch, dir: join(parent, "bin"), pins: pins() });
    expect(out).toMatchObject({ ok: false, code: "write_failed" });
    expect(readdirSync(parent)).toEqual(["bin"]);
  });

  test("a processor with no release file, and a computer that isn't a Mac, download nothing", async () => {
    const { fetch, asked } = serving(kanataZip);
    const ppc = await downloadTool("kanata", () => undefined, { platform: "darwin", arch: "ppc64", fetch, dir: scratch(), pins: pins() });
    expect(ppc).toEqual({ ok: false, code: "no_asset", reason: "kanata 1.12.0's release has no download for this Mac's processor, so keyloom can't get it. Its release page lists what there is." });
    const linux = await downloadTool("zapp", () => undefined, { platform: "linux", arch: "x64", fetch, dir: scratch(), pins: pins() });
    expect(linux).toMatchObject({ ok: false, code: "unsupported_platform" });
    expect(asked).toEqual([]);
  });

  test("the test preload refuses a real download, so a forgotten fake never reaches GitHub", async () => {
    const out = await downloadTool("zapp", () => undefined, { ...mac, dir: scratch() });
    expect(out).toMatchObject({ ok: false, code: "download_failed" });
    expect(out.ok ? "" : out.reason).toContain("refusing to download");
  });
});

describe("the pins", () => {
  test("kanata's pin is the version the MacBook board writes for, and never a build that can run programs", () => {
    expect(PINNED_TOOLS.kanata.version).toBe(kanataRevision(showBoard("apple/macbook-ansi").definition).kanataVersion);
    for (const asset of Object.values(PINNED_TOOLS.kanata.assets)) expect(asset.member).not.toContain("cmd_allowed");
  });

  test("every pin is an official GitHub release file over HTTPS, of its own tag, with two SHA-256 values", () => {
    const repos = { kanata: "jtroo/kanata", zapp: "zsa/zapp" } as const;
    for (const [tool, pin] of Object.entries(PINNED_TOOLS) as Array<[keyof typeof repos, PinnedTool]>) {
      expect(pin.releasePage).toBe(`https://github.com/${repos[tool]}/releases/tag/v${pin.version}`);
      expect(Object.keys(pin.assets).sort()).toEqual(["arm64", "x64"]);
      for (const asset of Object.values(pin.assets)) {
        expect(asset.url.startsWith(`https://github.com/${repos[tool]}/releases/download/v${pin.version}/`)).toBe(true);
        expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(asset.binarySha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  test("canDownload: a Mac on arm64 or x64; nothing else", () => {
    expect(canDownload("kanata", { platform: "darwin", arch: "arm64" })).toBe(true);
    expect(canDownload("zapp", { platform: "darwin", arch: "x64" })).toBe(true);
    expect(canDownload("zapp", { platform: "darwin", arch: "ia32" })).toBe(false);
    expect(canDownload("kanata", { platform: "linux", arch: "x64" })).toBe(false);
    expect(pinnedAsset("zapp", { platform: "darwin", arch: "arm64" })?.url).toBe("https://github.com/zsa/zapp/releases/download/v1.0.2/zapp-macos-aarch64.tar.gz");
  });

  // Opt-in: downloads the four real files into a scratch folder and checks every pin. Run it when a pin changes.
  test.skipIf(process.env.KEYLOOM_DOWNLOAD_TESTS !== "1")("the real release files match their pins", async () => {
    for (const tool of ["kanata", "zapp"] as const) {
      for (const arch of ["arm64", "x64"]) {
        const dir = scratch();
        const out = await downloadTool(tool, () => undefined, { platform: "darwin", arch, dir, fetch: (url, init) => fetch(url, init) });
        expect(out).toEqual({ ok: true, path: join(dir, tool) });
      }
    }
  }, 120_000);
});

describe("where keyloom keeps them", () => {
  test("KEYLOOM_TOOLS_DIR, or the person's Application Support folder", () => {
    expect(keptToolsDir({ KEYLOOM_TOOLS_DIR: "/scratch/bin" })).toBe("/scratch/bin");
    expect(keptToolsDir({})).toEndWith(join("Library", "Application Support", "keyloom", "bin"));
  });

  test("a kept kanata is found after every place the person installs one, and a folder of the same name is not a tool", async () => {
    const dir = scratch();
    const env = { KEYLOOM_TOOLS_DIR: dir };
    expect(keptTool("kanata", env)).toBeUndefined();
    await Bun.write(join(dir, "zapp", "x"), "");
    expect(keptTool("zapp", env)).toBeUndefined();
    await downloadTool("kanata", () => undefined, { ...mac, fetch: serving(kanataZip).fetch, dir, pins: pins() });
    expect(keptTool("kanata", env)).toBe(join(dir, "kanata"));
    // findKanata reads the same folder. PATH and Homebrew come first, so this holds only where neither has kanata.
    if (Bun.which("kanata") === null && !existsSync("/opt/homebrew/bin/kanata") && !existsSync("/usr/local/bin/kanata")) {
      expect(findKanata(env)).toBe(join(dir, "kanata"));
    }
    expect(findKanata({ ...env, KEYLOOM_KANATA_BIN: join(dir, "kanata") })).toBe(join(dir, "kanata"));
  });
});
