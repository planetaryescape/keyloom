// Reads a Layout Editor export: the .keymap file, or the folder of a template config that holds
// glove80.keymap beside glove80.conf. A .conf with the same name as the .keymap is read when there is one.
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { ZmkImportError } from "./import-error.ts";

export type ZmkSourceFiles = {
  /** Suggested layout name, from the file name (the Layout Editor names its export `<layout_name>.keymap`). */
  name: string;
  keymap: string;
  conf?: string;
};

const MAX_BYTES = 8 * 1024 * 1024;

async function text(path: string): Promise<string | undefined> {
  const f = Bun.file(path);
  if (!(await f.exists())) return undefined;
  if (f.size > MAX_BYTES) throw new ZmkImportError(`${path} is larger than ${MAX_BYTES} bytes`);
  return f.text();
}

export async function readZmkSource(path: string): Promise<ZmkSourceFiles> {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new ZmkImportError(`${path} does not exist`);
  }
  let keymapPath = path;
  if (info.isDirectory()) {
    const found = (await readdir(path)).filter((f) => f.endsWith(".keymap"));
    if (found.length !== 1) throw new ZmkImportError(found.length === 0 ? `no .keymap file in ${path}` : `more than one .keymap file in ${path} (${found.join(", ")}); pass the one to import`);
    keymapPath = join(path, found[0] as string);
  } else if (extname(path) !== ".keymap") {
    throw new ZmkImportError(`${basename(path)} is not a .keymap file; export one from the Layout Editor with its Export button`);
  }
  const keymap = await text(keymapPath);
  if (keymap === undefined) throw new ZmkImportError(`${keymapPath} does not exist`);
  const stem = basename(keymapPath, ".keymap");
  const conf = await text(join(dirname(keymapPath), `${stem}.conf`));
  return { name: stem, keymap, ...(conf === undefined ? {} : { conf }) };
}
