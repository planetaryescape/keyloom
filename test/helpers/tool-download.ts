// Small release archives for the tool download tests (D-560, D-561), pinned the way the real ones are, and a fetcher that serves them. No
// test that uses these reaches GitHub.
import { zipSync } from "fflate";
import type { Fetcher, PinnedTool } from "../../src/app/tool-download.ts";

export const sha = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export const KANATA = new TextEncoder().encode("#!/bin/sh\necho kanata 1.12.0\n");
export const CMD_ALLOWED = new TextEncoder().encode("#!/bin/sh\necho kanata with cmd\n");
export const ZAPP = new TextEncoder().encode("#!/bin/sh\necho zapp\n");
/** Shaped like kanata's: the plain build beside the one that can run programs. */
export const kanataZip = zipSync({ kanata_macos_arm64: KANATA, kanata_macos_cmd_allowed_arm64: CMD_ALLOWED });
export const zappTar = await new Bun.Archive({ zapp: ZAPP, LICENSE: "MIT" }, { compress: "gzip" }).bytes();

/** Pins for the archives above, for arm64 only. `binary` pins another program inside kanata's zip. */
export function testPins(over: { binary?: Uint8Array } = {}): Record<"kanata" | "zapp", PinnedTool> {
  return {
    kanata: {
      name: "kanata", version: "1.12.0",
      assets: { arm64: { url: "https://github.com/jtroo/kanata/releases/download/v1.12.0/k.zip", size: kanataZip.byteLength, sha256: sha(kanataZip), archive: "zip", member: "kanata_macos_arm64", binarySha256: sha(over.binary ?? KANATA) } },
    },
    zapp: {
      name: "Zapp", version: "1.0.2",
      assets: { arm64: { url: "https://github.com/zsa/zapp/releases/download/v1.0.2/z.tar.gz", size: zappTar.byteLength, sha256: sha(zappTar), archive: "tar.gz", member: "zapp", binarySha256: sha(ZAPP) } },
    },
  };
}

/** A fetcher that serves `body` for every URL and records what it was asked. `url` is where the answer says it came from. */
export function serving(body: Uint8Array, init: { status?: number; url?: string } = {}) {
  const asked: string[] = [];
  const fetch: Fetcher = async (url) => {
    asked.push(url);
    const response = new Response(new Blob([body as Uint8Array<ArrayBuffer>]), { status: init.status ?? 200 });
    Object.defineProperty(response, "url", { value: init.url ?? url });
    return response;
  };
  return { fetch, asked };
}
