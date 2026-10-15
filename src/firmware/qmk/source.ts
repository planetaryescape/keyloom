// Reads an Oryx source download: the zip, or the folder it unpacks to.
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { unzipSync } from "fflate";

export class ImportError extends Error {
  override name = "ImportError";
}

export type SourceFiles = {
  /** Suggested layout name, from `<vendor>_<board>_<name>_source`. */
  name: string;
  keymapC: string;
  configH?: string;
  rulesMk?: string;
  keymapJson?: string;
};

const WANTED = new Set(["keymap.c", "config.h", "rules.mk", "keymap.json"]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function nameFrom(folder: string, fallback: string): string {
  const m = /^[a-z0-9]+_[a-z0-9]+_(.+)_source$/i.exec(folder);
  return m?.[1] ?? (folder || fallback);
}

function build(name: string, files: Map<string, string>): SourceFiles {
  const keymapC = files.get("keymap.c");
  if (keymapC === undefined) throw new ImportError("no keymap.c found in the Oryx source");
  const out: SourceFiles = { name, keymapC };
  const configH = files.get("config.h");
  const rulesMk = files.get("rules.mk");
  const keymapJson = files.get("keymap.json");
  if (configH !== undefined) out.configH = configH;
  if (rulesMk !== undefined) out.rulesMk = rulesMk;
  if (keymapJson !== undefined) out.keymapJson = keymapJson;
  return out;
}

async function readZip(path: string): Promise<SourceFiles> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  // Only keymap.c and its neighbours are inflated; the zip also carries two firmware binaries.
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => WANTED.has(f.name.split("/").pop() ?? "") && f.originalSize <= MAX_FILE_BYTES,
    });
  } catch (err) {
    throw new ImportError(`${path} is not a readable zip: ${(err as Error).message}`);
  }
  const keymapEntry = Object.keys(entries).find((n) => n.endsWith("keymap.c"));
  if (!keymapEntry) throw new ImportError(`${basename(path)} has no keymap.c; is it Oryx's source download?`);
  const dir = keymapEntry.slice(0, keymapEntry.length - "keymap.c".length);
  const files = new Map<string, string>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith(dir) && !name.slice(dir.length).includes("/")) files.set(name.slice(dir.length), new TextDecoder().decode(data));
  }
  return build(nameFrom(basename(dir.replace(/\/$/, "")), basename(path, extname(path))), files);
}

async function readFolder(path: string): Promise<SourceFiles> {
  let dir = path;
  if (!(await Bun.file(join(dir, "keymap.c")).exists())) {
    // The unpacked zip nests the source one level down.
    const nested = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.endsWith("_source"));
    const only = nested[0];
    if (nested.length === 1 && only) dir = join(dir, only.name);
    else throw new ImportError(`no keymap.c in ${path}`);
  }
  const files = new Map<string, string>();
  for (const leaf of WANTED) {
    const f = Bun.file(join(dir, leaf));
    if (await f.exists()) {
      if (f.size > MAX_FILE_BYTES) throw new ImportError(`${join(dir, leaf)} is larger than ${MAX_FILE_BYTES} bytes`);
      files.set(leaf, await f.text());
    }
  }
  return build(nameFrom(basename(dir), basename(path)), files);
}

export async function readOryxSource(path: string): Promise<SourceFiles> {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new ImportError(`${path} does not exist`);
  }
  return info.isDirectory() ? readFolder(path) : readZip(path);
}
