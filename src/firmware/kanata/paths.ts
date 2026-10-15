// Where keyloom's kanata files live (D-233): its own folder, outside BK's dotfiles, in the place kanata itself looks.
import { homedir } from "node:os";
import { join } from "node:path";
import { KBD_FILE, SAFE_FILE } from "./generate.ts";

export type RemapperPaths = { dir: string; kbd: string; safe: string; plist: string };

/** `home` is injectable so tests use a temporary directory and never the real one. */
export function remapperPaths(home = homedir()): RemapperPaths {
  const dir = join(home, "Library", "Application Support", "kanata");
  return { dir, kbd: join(dir, KBD_FILE), safe: join(dir, SAFE_FILE), plist: join(dir, "dev.keyloom.kanata.plist") };
}
