// Getting kanata or Zapp on a Mac without Homebrew (D-560, D-561). keyloom downloads the release it targets from the project's own GitHub
// release over HTTPS, checks the file's SHA-256 against the value pinned here, takes the one program it needs out of the archive, checks that
// too, and only then writes it into its own folder (src/firmware/toolchain/kept-tools.ts). Nothing is written, and nothing runs, before both
// checks pass. There is no "latest": a new version is a new pin in this file, checked by hand.
import { join } from "node:path";
import { unzipSync } from "fflate";
import { findKanata } from "../firmware/kanata/binary.ts";
import { KEPT_TOOLS, type KeptTool, findTool, isKeptTool, keptToolsDir } from "../firmware/toolchain/kept-tools.ts";
import { writeFresh } from "../firmware/toolchain/write-fresh.ts";

export { KEPT_TOOLS, type KeptTool, isKeptTool };

export type DownloadArch = "arm64" | "x64";

/** One release file: where it is, what it hashes to, and the program inside it with that program's own hash. */
export type PinnedAsset = { url: string; size: number; sha256: string; archive: "zip" | "tar.gz"; member: string; binarySha256: string };

export type PinnedTool = { name: string; version: string; assets: Partial<Record<DownloadArch, PinnedAsset>> };

/**
 * The pins. Read from `gh release view` and from the files themselves on 2026-11-13: each archive was downloaded once, its SHA-256 compared
 * with GitHub's asset digest (and kanata's own `sha256sums`), and the program inside hashed with `shasum -a 256`. kanata's zips hold two
 * builds; keyloom takes the plain one, built without `cmd`, never `kanata_macos_cmd_allowed_*` (D-498).
 */
export const PINNED_TOOLS: Record<KeptTool, PinnedTool> = {
  kanata: {
    name: "kanata",
    version: "1.12.0",
    assets: {
      arm64: {
        url: "https://github.com/jtroo/kanata/releases/download/v1.12.0/macos-binaries-arm64.zip", size: 2_367_443,
        sha256: "839769d189911b5881e11550eaa2039705213fb725865d088f5a2e3a6c10de32", archive: "zip",
        member: "kanata_macos_arm64", binarySha256: "ca1f6c52c66f1486e21eb31eb0aa4e0d5248239ff3eea887ecb7ebb80caa133b",
      },
      x64: {
        url: "https://github.com/jtroo/kanata/releases/download/v1.12.0/macos-binaries-x64.zip", size: 2_377_539,
        sha256: "bdb8b2f7ae2a648336a2561c7c6c00a736cd76e012035df651114b304c5ffb01", archive: "zip",
        member: "kanata_macos_x64", binarySha256: "c98b4d2e9edccc26a405a55183de880ce15a8d9087803951e80d487bba14a7bf",
      },
    },
  },
  zapp: {
    name: "Zapp",
    version: "1.0.2",
    assets: {
      arm64: {
        url: "https://github.com/zsa/zapp/releases/download/v1.0.2/zapp-macos-aarch64.tar.gz", size: 3_229_402,
        sha256: "5028e38c9976097ba8950c5ec297d2901ba3aee30ed5b504bc2f827390f0ab15", archive: "tar.gz",
        member: "zapp", binarySha256: "12dac6da8d31cacfcd60405e1323345f1b6319a2631bdf422be6ec6d155df642",
      },
      x64: {
        url: "https://github.com/zsa/zapp/releases/download/v1.0.2/zapp-macos-x86_64.tar.gz", size: 3_539_635,
        sha256: "e62a3c2cdabc7b2b2917e934499bcfad57610236d25a0333c8c30161b3167515", archive: "tar.gz",
        member: "zapp", binarySha256: "b594fadc0ac33ef0923605c52ad741a41c97be4516722fd5d4005874033985f0",
      },
    },
  },
};

export type DownloadErrorCode = "unsupported_platform" | "no_asset" | "download_failed" | "checksum_mismatch" | "write_failed" | "cancelled";
export type DownloadOutcome = { ok: true; path: string } | { ok: false; code: DownloadErrorCode; reason: string };

/** `fetch`'s shape. Tests pass a fake, so no test downloads anything. */
export type Fetcher = (url: string, init: { signal?: AbortSignal; redirect: "follow" }) => Promise<Response>;

export type DownloadDeps = {
  fetch?: Fetcher;
  /** Where the tool is kept; the default is keptToolsDir(). */
  dir?: string;
  platform?: NodeJS.Platform | undefined;
  arch?: string | undefined;
  /** The pins; tests pin small archives they build themselves. The default is PINNED_TOOLS. */
  pins?: Record<KeptTool, PinnedTool>;
};

const realFetch: Fetcher = (url, init) => {
  // The test preload sets this, so a forgotten fake fails its test instead of downloading.
  if (process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS === "1") return Promise.reject(new Error(`refusing to download ${url} in a test`));
  return fetch(url, init);
};

const archOf = (arch: string): DownloadArch | null => (arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null);

/** The file keyloom would download here, or null when there is none for this computer. */
export function pinnedAsset(tool: KeptTool, deps: Pick<DownloadDeps, "platform" | "arch" | "pins"> = {}): PinnedAsset | null {
  if ((deps.platform ?? process.platform) !== "darwin") return null;
  const arch = archOf(deps.arch ?? process.arch);
  return arch === null ? null : (deps.pins ?? PINNED_TOOLS)[tool].assets[arch] ?? null;
}

/** Whether keyloom can download this tool here: a Mac whose processor has a pinned release file. */
export const canDownload = (tool: KeptTool, deps: Pick<DownloadDeps, "platform" | "arch"> = {}): boolean => pinnedAsset(tool, deps) !== null;

/**
 * The file to download here, or why keyloom can't download this tool on this computer. A job checks it before it starts, so a refusal is an
 * answer at once; downloadTool checks it again itself.
 */
export function downloadReady(tool: KeptTool, deps: Pick<DownloadDeps, "platform" | "arch" | "pins"> = {}): { ok: true; asset: PinnedAsset } | Extract<DownloadOutcome, { ok: false }> {
  const pin = (deps.pins ?? PINNED_TOOLS)[tool];
  if ((deps.platform ?? process.platform) !== "darwin") return { ok: false, code: "unsupported_platform", reason: `keyloom downloads ${pin.name} on a Mac only.` };
  const asset = pinnedAsset(tool, deps);
  if (asset === null) {
    return { ok: false, code: "no_asset", reason: `${pin.name} ${pin.version}'s release has no download for this Mac's processor, so keyloom can't get it. Its release page lists what there is.` };
  }
  return { ok: true, asset };
}

const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const megabytes = (n: number): string => (n / 1_000_000).toFixed(1);

/**
 * Downloads, checks and keeps one tool. `onLine` gets progress lines for the page's log and the terminal; `signal` cancels the download.
 * Every failure has a code the page maps to words and a reason written for a person.
 */
export async function downloadTool(tool: KeptTool, onLine: (line: string) => void, deps: DownloadDeps = {}, signal?: AbortSignal): Promise<DownloadOutcome> {
  const ready = downloadReady(tool, deps);
  if (!ready.ok) return ready;
  const { asset } = ready;
  const pin = (deps.pins ?? PINNED_TOOLS)[tool];
  const cancelled: DownloadOutcome = { ok: false, code: "cancelled", reason: "You cancelled the download. keyloom kept nothing." };
  const failed = (detail: string): DownloadOutcome => ({ ok: false, code: "download_failed", reason: `keyloom couldn't download ${pin.name}: ${detail}. Check that this computer is online, then try again.` });
  const mismatch: DownloadOutcome = {
    ok: false, code: "checksum_mismatch",
    reason: `The file keyloom downloaded isn't ${pin.name} ${pin.version} as released: its checksum doesn't match. keyloom kept none of it. Try again, and if it happens again, get ${pin.name} from its release page.`,
  };

  onLine(`keyloom: downloading ${pin.name} ${pin.version} from ${asset.url}`);
  let bytes: Uint8Array;
  try {
    const response = await (deps.fetch ?? realFetch)(asset.url, { redirect: "follow", ...(signal === undefined ? {} : { signal }) });
    // GitHub sends release files from its own storage host; a redirect that leaves HTTPS is refused before a byte is read.
    if (response.url !== "" && !response.url.startsWith("https://")) return failed("GitHub sent the file over a connection that isn't encrypted");
    if (!response.ok || response.body === null) return failed(`GitHub answered ${response.status}`);
    const read = await readCapped(response.body, asset.size, (got) => onLine(`keyloom: ${megabytes(got)} of ${megabytes(asset.size)} MB`));
    // Larger than the release file: it can't be the release file, so reading stops there.
    if (read === null) return mismatch;
    bytes = read;
  } catch (err) {
    if (signal?.aborted) return cancelled;
    return failed(err instanceof Error ? err.message : String(err));
  }
  if (signal?.aborted) return cancelled;

  if (sha256(bytes) !== asset.sha256) {
    onLine("keyloom: the download's SHA-256 doesn't match the pinned one; nothing was kept");
    return mismatch;
  }
  const program = await extract(bytes, asset);
  if (program === null || sha256(program) !== asset.binarySha256) {
    onLine(`keyloom: ${asset.member} in the download doesn't match the pinned SHA-256; nothing was kept`);
    return mismatch;
  }
  onLine("keyloom: the SHA-256 matches the release");

  const dir = deps.dir ?? keptToolsDir();
  const path = join(dir, tool);
  try {
    // Written beside its final name, made executable, then renamed into place, so a lookup never finds half a program.
    await writeFresh(path, program, { mode: 0o755 });
  } catch (err) {
    return { ok: false, code: "write_failed", reason: `keyloom checked ${pin.name} but couldn't save it in ${dir}: ${err instanceof Error ? err.message : String(err)}` };
  }
  onLine(`keyloom: kept ${pin.name} ${pin.version} in ${dir}`);
  return { ok: true, path };
}

/**
 * The whole body, or null once it is larger than `size`. The pin gives the size, so the bytes go straight into one buffer of that size.
 * `progress` is called at each quarter.
 */
async function readCapped(body: ReadableStream<Uint8Array>, size: number, progress: (got: number) => void): Promise<Uint8Array | null> {
  const all = new Uint8Array(size);
  let got = 0;
  let quarter = 0;
  for await (const chunk of body) {
    if (got + chunk.byteLength > size) return null;
    all.set(chunk, got);
    got += chunk.byteLength;
    const now = Math.floor((got / size) * 4);
    if (now > quarter) {
      quarter = now;
      progress(got);
    }
  }
  // A shorter body is not the release file either; the hash refuses it.
  return all.subarray(0, got);
}

/**
 * The one program keyloom wants from a release archive, or null when it isn't there or the archive can't be read. fflate reads zips (kanata);
 * Bun.Archive reads tar.gz (Zapp). Only the named file is read: nothing else in the archive is written anywhere.
 */
async function extract(bytes: Uint8Array, asset: PinnedAsset): Promise<Uint8Array | null> {
  try {
    if (asset.archive === "zip") return unzipSync(bytes, { filter: (file) => file.name === asset.member })[asset.member] ?? null;
    const files = await new Bun.Archive(bytes).files();
    const file = files.get(asset.member);
    return file === undefined ? null : new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/** The copy of a tool keyloom would use now, from every place it looks: a kanata or Zapp the person installed comes before keyloom's own. */
export const toolInUse = (tool: KeptTool): string | undefined => (tool === "kanata" ? findKanata() : findTool(tool));
