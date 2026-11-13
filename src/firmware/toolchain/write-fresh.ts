import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes `path` as a new file: the content goes to a temporary name beside it and is renamed into place. A file
 * rewritten in place can look cut short to a Docker container reading it through Colima's sshfs mount (a Glove80
 * build failed on a truncated default.nix that the host had written whole), while a new directory entry has no
 * old size to be served. Use it for every file written into a folder that a container mounts before it runs. `mode` is set
 * before the rename, so a program is never found at its name before it can run (D-560).
 */
export async function writeFresh(path: string, content: string | Uint8Array, opts: { mode?: number } = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    await Bun.write(temporary, content);
    if (opts.mode !== undefined) await chmod(temporary, opts.mode);
    await rename(temporary, path);
  } catch (err) {
    await rm(temporary, { force: true });
    throw err;
  }
}
