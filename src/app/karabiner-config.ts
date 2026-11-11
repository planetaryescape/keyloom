// Reads Karabiner-Elements' own config from the one place it keeps it, so the MacBook's import card can take it with a button
// (R1-24): ~/.config/karabiner is a hidden folder that a file picker doesn't show. Read only; the import that follows is the same
// as a dropped file's, and Karabiner's rules stay in its file.
import { homedir } from "node:os";
import { join } from "node:path";

export const KARABINER_FILENAME = "karabiner.json";
/** Where Karabiner-Elements keeps its settings, the path the import card's steps name. */
export const karabinerConfigPath = (home: string = homedir()): string => join(home, ".config", "karabiner", KARABINER_FILENAME);

// A real karabiner.json is tens of kilobytes; anything far bigger is not one, and isn't worth holding in memory.
const MAX_BYTES = 5 * 1024 * 1024;

export type KarabinerConfig = { status: "found"; filename: string; content: string } | { status: "missing" } | { status: "too_large" };

export async function readKarabinerConfig(home: string = homedir()): Promise<KarabinerConfig> {
  const file = Bun.file(karabinerConfigPath(home));
  if (!(await file.exists())) return { status: "missing" };
  if (file.size > MAX_BYTES) return { status: "too_large" };
  return { status: "found", filename: KARABINER_FILENAME, content: await file.text() };
}
