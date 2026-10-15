// Where a UF2 bootloader's drive shows up. This is the only place that names a real mount root: a
// flash writes to whatever volume these return, so the root is a parameter everywhere else and tests
// pass a temporary directory. test/helpers/no-real-flash.ts replaces defaultVolumesRoot so that a test
// which forgets to do that fails instead of copying onto a keyboard.
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { capture, which } from "../toolchain/run.ts";

/** Finds the mounted volume with this label, or null when it isn't mounted. */
export type VolumeFinder = (label: string) => Promise<string | null>;

/** macOS mounts removable volumes under /Volumes; Linux desktops under /run/media/<user>. */
export function defaultVolumesRoot(): string {
  return process.platform === "darwin" ? "/Volumes" : `/run/media/${process.env.USER ?? ""}`;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Volumes are directories named by label under `root`. */
export function volumeFinderAt(root: string): VolumeFinder {
  const base = resolve(root);
  return async (label) => {
    const path = join(base, label);
    return (await isDir(path)) ? path : null;
  };
}

/** Linux without a predictable mount root: `lsblk -o LABEL,MOUNTPOINT`, which lists a label next to where it is mounted. */
export function lsblkFinder(): VolumeFinder {
  return async (label) => {
    if (!which("lsblk")) return null;
    const r = await capture(["lsblk", "-rno", "LABEL,MOUNTPOINT"], { timeoutMs: 10_000 });
    if (r.exitCode !== 0) return null;
    for (const line of r.stdout.split("\n")) {
      const [name, ...rest] = line.split(" ");
      // -r escapes spaces in a mount point as \x20.
      const mount = rest.join(" ").replace(/\\x20/g, " ").trim();
      if (name === label && mount !== "") return mount;
    }
    return null;
  };
}

/** The finder for this machine: /Volumes on macOS, lsblk elsewhere. */
export function defaultVolumeFinder(): VolumeFinder {
  const root = defaultVolumesRoot();
  return process.platform === "darwin" ? volumeFinderAt(root) : lsblkFinder();
}
