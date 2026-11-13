// Reads an Oryx source download (the zip, or the folder it unpacks to), a QMK keymap folder, or a QMK Configurator keymap.json.
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { unzipSync } from "fflate";
import { ImportError } from "./import-error.ts";
import { holdsLayers, keymapJsonToC, keymapName } from "./keymap-json.ts";

export { ImportError };

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
const MAX_ZIP_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1024;
const MAX_SOURCE_BYTES = 4 * MAX_FILE_BYTES;

function nameFrom(folder: string, fallback: string): string {
  const m = /^[a-z0-9]+_[a-z0-9]+_(.+)_source$/i.exec(folder);
  return m?.[1] ?? (folder || fallback);
}

function build(name: string, files: Map<string, string>): SourceFiles {
  let keymapC = files.get("keymap.c");
  let keymapJson = files.get("keymap.json");
  // A keymap folder with only a keymap.json is QMK's Configurator format; its layers become the keymap and the rest stays build input.
  if (keymapC === undefined && keymapJson !== undefined && holdsLayers(keymapJson)) ({ keymapC, rest: keymapJson } = keymapJsonToC(keymapJson, "keymap.json"));
  if (keymapC === undefined) throw new ImportError("no keymap.c or keymap.json with layers found in the source");
  const out: SourceFiles = { name, keymapC };
  const configH = files.get("config.h");
  const rulesMk = files.get("rules.mk");
  if (configH !== undefined) out.configH = configH;
  if (rulesMk !== undefined) out.rulesMk = rulesMk;
  if (keymapJson !== undefined) out.keymapJson = keymapJson;
  return out;
}

async function readZip(path: string): Promise<SourceFiles> {
  const bytes = new Uint8Array(await Bun.file(path).slice(0, MAX_ZIP_BYTES + 1).arrayBuffer());
  if (bytes.length > MAX_ZIP_BYTES) throw new ImportError(`${path} is larger than ${MAX_ZIP_BYTES} bytes`);
  // Inspect the directory without inflating. A compressed upload limit alone does not bound its output.
  let entries: Record<string, Uint8Array>;
  let keymapEntry: string | undefined;
  let count = 0;
  let total = 0;
  try {
    unzipSync(bytes, { filter: (f) => {
      if (++count > MAX_ZIP_ENTRIES) throw new ImportError(`zip has more than ${MAX_ZIP_ENTRIES} entries`);
      if (!WANTED.has(f.name.split("/").pop() ?? "")) return false;
      if (f.originalSize > MAX_FILE_BYTES) throw new ImportError(`${f.name} is larger than ${MAX_FILE_BYTES} bytes`);
      total += f.originalSize;
      if (total > MAX_SOURCE_BYTES) throw new ImportError(`zip source exceeds ${MAX_SOURCE_BYTES} decompressed bytes`);
      if (f.name.split("/").pop() === "keymap.c" && keymapEntry === undefined) keymapEntry = f.name;
      return false;
    } });
    if (keymapEntry === undefined) throw new ImportError(`${basename(path)} has no keymap.c; is it Oryx's source download?`);
    const selected = keymapEntry.slice(0, -"keymap.c".length);
    entries = unzipSync(bytes, {
      filter: (f) => f.name.startsWith(selected) && WANTED.has(f.name.slice(selected.length)),
    });
  } catch (err) {
    throw new ImportError(`${path} is not a readable zip: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (keymapEntry === undefined) throw new ImportError(`${basename(path)} has no keymap.c; is it Oryx's source download?`);
  const dir = keymapEntry.slice(0, keymapEntry.length - "keymap.c".length);
  const files = new Map<string, string>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith(dir) && !name.slice(dir.length).includes("/")) files.set(name.slice(dir.length), new TextDecoder().decode(data));
  }
  return build(nameFrom(basename(dir.replace(/\/$/, "")), basename(path, extname(path))), files);
}

async function readFolder(path: string): Promise<SourceFiles> {
  let dir = path;
  if (!(await Bun.file(join(dir, "keymap.c")).exists()) && !(await Bun.file(join(dir, "keymap.json")).exists())) {
    // The unpacked zip nests the source one level down.
    const nested = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.endsWith("_source"));
    const only = nested[0];
    if (nested.length === 1 && only) dir = join(dir, only.name);
    else throw new ImportError(`no keymap.c or keymap.json in ${path}`);
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
  if (info.isDirectory()) return readFolder(path);
  // A keymap.json given on its own takes the name it gives itself ("keymap": "default"); an upload's folder is a temporary one.
  if (extname(path) === ".json") {
    if (info.size > MAX_FILE_BYTES) throw new ImportError(`${path} is larger than ${MAX_FILE_BYTES} bytes`);
    const json = await Bun.file(path).text();
    return build(keymapName(json) ?? basename(path, ".json"), new Map([["keymap.json", json]]));
  }
  if (info.size > MAX_ZIP_BYTES) throw new ImportError(`${path} is larger than ${MAX_ZIP_BYTES} bytes`);
  return readZip(path);
}
