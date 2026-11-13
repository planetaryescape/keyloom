import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * A bind mount on Colima can follow a replaced host directory. Every run therefore gets a
 * new sibling path. The stable path is only a post-run debug snapshot, never a later input.
 * The caller holds the stable path's lock through the callback and container exit.
 */
export async function withWorkspace<T>(base: string, run: (dir: string) => Promise<T>): Promise<T> {
  await mkdir(dirname(base), { recursive: true });
  const dir = await mkdtemp(`${base}.run-`);
  try {
    return await run(dir);
  } finally {
    try {
      await rm(base, { recursive: true, force: true });
      await rename(dir, base);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
