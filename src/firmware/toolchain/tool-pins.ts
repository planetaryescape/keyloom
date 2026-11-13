// The release files keyloom downloads kanata and Zapp from, and what each must hash to (D-560, D-561). The download (src/app/tool-download.ts)
// checks a file against these before it keeps it, and the lookups (kept-tools.ts) check the kept file again before keyloom uses it, so a
// file changed after the download is never run or set up as root.
export const KEPT_TOOLS = ["kanata", "zapp"] as const;
export type KeptTool = (typeof KEPT_TOOLS)[number];

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

/** The computer to pick a file for, and the pins to pick from; tests pin small archives they build themselves. */
export type PinDeps = { platform?: NodeJS.Platform | undefined; arch?: string | undefined; pins?: Record<KeptTool, PinnedTool> | undefined };

const archOf = (arch: string): DownloadArch | null => (arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null);

/** The file keyloom would download here, or null when there is none for this computer. */
export function pinnedAsset(tool: KeptTool, deps: PinDeps = {}): PinnedAsset | null {
  if ((deps.platform ?? process.platform) !== "darwin") return null;
  const arch = archOf(deps.arch ?? process.arch);
  return arch === null ? null : (deps.pins ?? PINNED_TOOLS)[tool].assets[arch] ?? null;
}
