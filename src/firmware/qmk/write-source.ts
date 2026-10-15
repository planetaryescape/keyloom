import { rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFresh } from "../toolchain/write-fresh.ts";
import type { GeneratedSource } from "./generate.ts";

/**
 * Writes the generated files into `dir`. With `clean`, `dir` is emptied first so a file the layout no
 * longer needs can't linger and be built; only pass it for a directory keyloom owns, never one a user named.
 */
export async function writeSource(dir: string, source: GeneratedSource, opts: { clean?: boolean } = {}): Promise<void> {
  if (opts.clean) await rm(dir, { recursive: true, force: true });
  for (const f of source.files) {
    const path = join(dir, f.path);
    await writeFresh(path, f.content);
  }
}
