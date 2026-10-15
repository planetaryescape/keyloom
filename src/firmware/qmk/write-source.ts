import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GeneratedSource } from "./generate.ts";

/**
 * Writes the generated files into `dir`. With `clean`, `dir` is emptied first so a file the layout no
 * longer needs can't linger and be built; only pass it for a directory keyloom owns, never one a user named.
 */
export async function writeSource(dir: string, source: GeneratedSource, opts: { clean?: boolean } = {}): Promise<void> {
  if (opts.clean) await rm(dir, { recursive: true, force: true });
  for (const f of source.files) {
    const path = join(dir, f.path);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, f.content);
  }
}
