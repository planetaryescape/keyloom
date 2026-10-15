// XDG paths (01#paths). On macOS the XDG defaults apply too (~/.local/share), not ~/Library.
import { homedir } from "node:os";
import { join } from "node:path";

/** `$XDG_DATA_HOME/keyloom`, or `override` (`--data-dir`) when given. */
export function dataDir(override?: string): string {
  if (override) return override;
  const xdg = process.env.XDG_DATA_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share"), "keyloom");
}

/** `$XDG_CACHE_HOME/keyloom`: pinned checkouts and fetched firmware files. */
export function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache"), "keyloom");
}

export const databasePath = (dir: string): string => join(dir, "keyloom.db");
export const logsDir = (dir: string): string => join(dir, "logs");
