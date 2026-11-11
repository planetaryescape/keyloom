// Reads Karabiner-Elements' own config from the one place it keeps it, so the MacBook's import card can take it with a button
// (R1-24): ~/.config/karabiner is a hidden folder that a file picker doesn't show. Read only; the import that follows is the same
// as a dropped file's, and Karabiner's rules stay in its file.
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const KARABINER_FILENAME = "karabiner.json";
/** Where Karabiner-Elements keeps its settings, the path the import card's steps name. */
export const karabinerConfigPath = (home: string = homedir()): string => join(home, ".config", "karabiner", KARABINER_FILENAME);

// A real karabiner.json is tens of kilobytes; anything far bigger is not one, and isn't worth holding in memory. The import the page
// sends it to has its own, larger cap (MAX_IMPORT_BYTES); app/ can't import that from the server (the module table).
const MAX_BYTES = 5 * 1024 * 1024;

export type KarabinerConfig =
  | { status: "found"; filename: string; content: string }
  | { status: "missing" }
  | { status: "too_large" }
  // macOS refused the read: the folder or file's permissions, or privacy protection on the server's process.
  | { status: "denied" }
  // Something other than a regular file is at that path. A FIFO there would block the read for ever, so it is never opened.
  | { status: "not_a_file" };

const errorCode = (error: unknown): string | undefined => (error as { code?: string } | null)?.code;
const DENIED = new Set(["EACCES", "EPERM"]);

export async function readKarabinerConfig(home: string = homedir()): Promise<KarabinerConfig> {
  const path = karabinerConfigPath(home);
  try {
    // stat follows a symlink, so a link to a FIFO or a folder is caught here, before anything is opened.
    const info = await stat(path);
    if (!info.isFile()) return { status: "not_a_file" };
    if (info.size > MAX_BYTES) return { status: "too_large" };
    return { status: "found", filename: KARABINER_FILENAME, content: await readFile(path, "utf8") };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return { status: "missing" };
    if (code !== undefined && DENIED.has(code)) return { status: "denied" };
    throw error;
  }
}
