// An import from the browser (D-171): the bytes become a file in a private temporary folder, and the
// same use case the CLI runs reads that file. The importers take paths, so this keeps one code path.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "./context.ts";
import { type ImportOutcome, importLayout } from "./layouts.ts";
import { UsageError } from "./errors.ts";

export type UploadInput = { board: string; filename: string; bytes: Uint8Array; name?: string | undefined };

// The importers decide what a file is from its extension, so it is kept; everything else about the name is not trusted.
const EXTENSIONS = new Set([".zip", ".keymap"]);

export function safeFilename(filename: string): string {
  const leaf = filename.split(/[\\/]/).at(-1) ?? "";
  const cleaned = leaf.replace(/[^\w.@+-]+/g, "_").replace(/^\.+/, "");
  const dot = cleaned.lastIndexOf(".");
  const extension = dot < 0 ? "" : cleaned.slice(dot).toLowerCase();
  if (!EXTENSIONS.has(extension)) throw new UsageError(`${leaf || "That file"} is not a .zip or a .keymap file`);
  return `${cleaned.slice(0, dot)}${extension}`;
}

export async function importUpload(app: App, input: UploadInput): Promise<ImportOutcome> {
  const filename = safeFilename(input.filename);
  if (input.bytes.length === 0) throw new UsageError(`${filename} is empty`);
  const dir = await mkdtemp(join(tmpdir(), "keyloom-import-"));
  try {
    const path = join(dir, filename);
    await writeFile(path, input.bytes);
    return await importLayout(app, { board: input.board, source: path, ...(input.name === undefined ? {} : { name: input.name }) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
