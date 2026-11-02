import { existsSync, mkdirSync, writeFileSync, openSync, closeSync, unlinkSync, rmdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { BoardDefinitionSchema } from "../boards/schema.ts";
import { serializeGeometry } from "../boards/geometry.ts";
import { showBoard } from "./boards.ts";
import { UsageError } from "./errors.ts";

export interface BoardContribution { boardId: string; files: Record<string, string> }
export interface ExportedBoardContribution { boardId: string; directory: string; files: string[] }

/** Exports board data only: never layouts, conversations, typing recordings or credentials. Nothing is published. */
export function prepareBoardContribution(boardId: string, as = boardId): BoardContribution {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(as)) throw new UsageError("use a board ID like maker/keyboard (lowercase letters, digits and dashes)");
  const board = showBoard(boardId);
  const definition = BoardDefinitionSchema.parse({ ...board.definition, id: as });
  const root = `boards/${as}`;
  const files = {
    [`${root}/board.json`]: `${JSON.stringify(definition, null, 2)}\n`,
    [`${root}/geometry.json`]: serializeGeometry(board.geometry),
    "CONTRIBUTION.md": `# Contribute ${definition.name}\n\nThis package contains board definitions only. It contains no personal layouts or recordings and has not been published.\n\n1. Clone https://github.com/planetaryescape/keyloom and run bun install.\n2. ${as.startsWith("local/") ? "Choose the maker/keyboard ID, rename the folder and update board.json's id. " : ""}Copy boards/ into the clone.\n3. Run /add-keyboard in Claude Code, or follow CONTRIBUTING.md. Keep the firmware geometry; use photos for display-only case details. A generated 3D case is a valid starting point.\n4. Run bun src/cli/main.ts boards check boards/<maker>/<keyboard>. Use a scratch --data-dir for imports/builds.\n5. Attach render-versus-photo screenshots. State exactly what was built, tested and (only with permission) flashed. An unflashed PR waits for owner verification.\n6. Open a PR containing only boards/<maker>/<keyboard>/ and any necessary docs/issues/ note.\n\nThe contribution skill is .claude/skills/add-keyboard/SKILL.md. Do not include this handoff file in the board PR.\n`,
  };
  return { boardId: as, files };
}

export function exportBoardContribution(boardId: string, out: string, as = boardId): ExportedBoardContribution {
  const prepared = prepareBoardContribution(boardId, as);
  const directory = resolve(out);
  if (existsSync(directory)) throw new UsageError("the contribution output directory already exists; choose a new directory so nothing is overwritten");
  mkdirSync(dirname(directory), { recursive: true });
  // Claim the output directory exclusively too: an existing empty directory is not ours to use.
  mkdirSync(directory);
  const createdFiles: string[] = [];
  const createdDirectories = new Set([directory]);
  try {
    for (const [path, text] of Object.entries(prepared.files)) {
      const target = join(directory, path);
      let parent = directory;
      for (const segment of path.split("/").slice(0, -1)) {
        parent = join(parent, segment);
        if (!existsSync(parent)) { mkdirSync(parent); createdDirectories.add(parent); }
      }
      const file = openSync(target, "wx");
      createdFiles.push(target);
      try { writeFileSync(file, text); }
      finally { closeSync(file); }
    }
  } catch (error) {
    // Remove only files we created. Non-recursive directory cleanup preserves anything another writer added.
    for (const file of createdFiles) {
      try { unlinkSync(file); } catch { /* Preserve the original export error if cleanup cannot finish. */ }
    }
    for (const parent of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      try { rmdirSync(parent); } catch { /* A nonempty directory belongs to another writer too; leave it intact. */ }
    }
    throw error;
  }
  return { boardId: prepared.boardId, directory, files: Object.keys(prepared.files) };
}
