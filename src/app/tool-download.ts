// Getting kanata or Zapp on a Mac without Homebrew (D-560, D-561). keyloom downloads the release it targets from the project's own GitHub
// release over HTTPS, checks the file's SHA-256 against the value pinned in keyloom's source (src/firmware/toolchain/tool-pins.ts), takes the one program it needs out of the archive, checks that
// too, and only then writes it into its own folder (src/firmware/toolchain/kept-tools.ts). Nothing is written, and nothing runs, before both
// checks pass. There is no "latest": a new version is a new pin in that file, checked by hand.
import { join } from "node:path";
import { unzipSync } from "fflate";
import { findKanata } from "../firmware/kanata/binary.ts";
import { KEPT_TOOLS, type KeptTool, findTool, isKeptTool, keptToolsDir } from "../firmware/toolchain/kept-tools.ts";
import { type DownloadArch, PINNED_TOOLS, type PinnedAsset, type PinnedTool, pinnedAsset } from "../firmware/toolchain/tool-pins.ts";
import { writeFresh } from "../firmware/toolchain/write-fresh.ts";

export { KEPT_TOOLS, type KeptTool, isKeptTool, type DownloadArch, PINNED_TOOLS, type PinnedAsset, type PinnedTool, pinnedAsset };

export type DownloadErrorCode = "unsupported_platform" | "no_asset" | "download_failed" | "checksum_mismatch" | "write_failed" | "cancelled";
export type DownloadOutcome = { ok: true; path: string } | { ok: false; code: DownloadErrorCode; reason: string };

/** `fetch`'s shape. Tests pass a fake, so no test downloads anything. */
export type Fetcher = (url: string, init: { signal?: AbortSignal; redirect: "manual" }) => Promise<Response>;

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
    const response = await fetchRelease(deps.fetch ?? realFetch, asset.url, signal);
    if (typeof response === "string") return failed(response);
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
  // Zapp's tar.gz is read asynchronously, so a Cancel can land during extraction; the write is the last point to honour it (PR #317 review).
  if (signal?.aborted) return cancelled;

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

/** GitHub answers a release URL with a redirect to its storage host (release-assets.githubusercontent.com in 2026-11, objects. before). */
const RELEASE_HOSTS: ReadonlySet<string> = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const MAX_REDIRECTS = 5;

/**
 * The release file's response, following GitHub's redirects one hop at a time, or why keyloom stopped. Every hop must be HTTPS and on
 * GitHub's hosts before keyloom asks it for anything. The hashes, not this check, are what make the file trustworthy: a file from anywhere
 * else could only fail them. The check keeps keyloom from fetching from an unencrypted or foreign place at all.
 */
async function fetchRelease(fetcher: Fetcher, url: string, signal: AbortSignal | undefined): Promise<Response | string> {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const where = new URL(at);
    if (where.protocol !== "https:") return "GitHub sent the file over a connection that isn't encrypted";
    if (!RELEASE_HOSTS.has(where.hostname)) return `GitHub sent the file from ${where.hostname}, which isn't one of GitHub's hosts`;
    const response = await fetcher(at, { redirect: "manual", ...(signal === undefined ? {} : { signal }) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (location === null) return `GitHub answered ${response.status} without saying where the file is`;
    at = new URL(location, at).href;
  }
  return "GitHub redirected the download too many times";
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
