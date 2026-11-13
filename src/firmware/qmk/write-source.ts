import { mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { workspaceParts, workspacePath } from "../toolchain/workspace-path.ts";
import { writeFresh } from "../toolchain/write-fresh.ts";
import type { GeneratedSource } from "./generate.ts";

/**
 * Writes the generated files into `dir`. With `clean`, `dir` is emptied first so a file the layout no
 * longer needs can't linger and be built; only pass it for a directory keyloom owns, never one a user named.
 */
export async function writeSource(dir: string, source: GeneratedSource, opts: { clean?: boolean; root?: string } = {}): Promise<void> {
  for (const f of source.files) workspaceParts(f.path);
  if (opts.root !== undefined) await workspacePath(opts.root, relative(opts.root, dir));
  if (opts.clean) {
    if (opts.root === undefined) throw new Error("Cleaning generated source requires its build workspace root");
    await rm(dir, { recursive: true, force: true });
  }
  await mkdir(dir, { recursive: true });
  for (const f of source.files) await workspacePath(dir, f.path);
  for (const f of source.files) {
    const path = join(dir, f.path);
    await writeFresh(path, f.content);
  }
}
