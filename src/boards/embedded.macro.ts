// Runs at bundle time (Bun macro), so the boards/ folder is inlined into `bun build --compile`
// binaries and nothing is read from disk at runtime. Adding a board needs no code change.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type EmbeddedBoard = { dir: string; board: string; geometry: string; skill?: string };

export function readBoards(): EmbeddedBoard[] {
  const root = join(import.meta.dir, "..", "..", "boards");
  const out: EmbeddedBoard[] = [];
  for (const vendor of readdirSync(root, { withFileTypes: true })) {
    if (!vendor.isDirectory()) continue;
    for (const board of readdirSync(join(root, vendor.name), { withFileTypes: true })) {
      if (!board.isDirectory()) continue;
      const dir = join(root, vendor.name, board.name);
      const skillFile = join(dir, "SKILL.md");
      const entry: EmbeddedBoard = {
        dir: `${vendor.name}/${board.name}`,
        board: readFileSync(join(dir, "board.json"), "utf8"),
        geometry: readFileSync(join(dir, "geometry.json"), "utf8"),
      };
      if (existsSync(skillFile)) entry.skill = readFileSync(skillFile, "utf8");
      out.push(entry);
    }
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}
