import { lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Check names before touching the filesystem, including names produced outside a board schema. */
export function workspaceParts(path: string): string[] {
  const parts = path.split("/");
  if (/^[A-Za-z]:/.test(path) || path.includes("\\") || path.includes("\0") || parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Error(`Unsafe build workspace path: ${JSON.stringify(path)}`);
  }
  return parts;
}

/** A container can leave symlinks in a writable checkout. Never follow them for host writes or cleanup. */
export async function workspacePath(root: string, path: string): Promise<string> {
  const parts = workspaceParts(path);
  let current = await realpath(root);
  for (const part of parts) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Build workspace path contains a symlink: ${current}`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") break;
      throw error;
    }
  }
  return resolve(root, ...parts);
}
