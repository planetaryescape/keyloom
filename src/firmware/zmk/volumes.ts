// Where a UF2 bootloader's drive shows up. This is the only place that names a real mount root: a
// flash writes to whatever volume these return, so the root is a parameter everywhere else and tests
// pass a temporary directory. test/helpers/no-real-flash.ts replaces defaultVolumesRoot so that a test
// which forgets to do that fails instead of copying onto a keyboard.
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { capture, which } from "../toolchain/run.ts";

/** Finds the mounted volume with this label, or null when it isn't mounted. Throws if the label is ambiguous. */
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
    const names = await readdir(base).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return [];
      throw err;
    });
    const matches: string[] = [];
    for (const name of names) {
      // macOS appends a number when another drive with the same label is mounted.
      if (name !== label && !(name.startsWith(`${label} `) && /^\d+$/.test(name.slice(label.length + 1)))) continue;
      const path = join(base, name);
      if (await isDir(path)) matches.push(path);
    }
    if (matches.length > 1) throw new Error(`Ambiguous boot drive ${label}: multiple mounts (${matches.join(", ")}). Disconnect the extra drive before retrying.`);
    return matches[0] ?? null;
  };
}

/** Linux without a predictable mount root: `lsblk -o LABEL,MOUNTPOINT`, which lists a label next to where it is mounted. */
export function lsblkFinder(): VolumeFinder {
  return async (label) => {
    if (!which("lsblk")) return null;
    const r = await capture(["lsblk", "-rno", "LABEL,MOUNTPOINT"], { timeoutMs: 10_000 });
    if (r.exitCode !== 0) return null;
    const matches: string[] = [];
    for (const line of r.stdout.split("\n")) {
      const [name, ...rest] = line.split(" ");
      // -r escapes spaces in a mount point as \x20.
      const mount = rest.join(" ").replace(/\\x20/g, " ").trim();
      if (name === label && mount !== "") matches.push(mount);
    }
    if (matches.length > 1) throw new Error(`Ambiguous boot drive ${label}: multiple mounts (${matches.join(", ")}). Disconnect the extra drive before retrying.`);
    return matches[0] ?? null;
  };
}

/** The finder for this machine: /Volumes on macOS, lsblk elsewhere. */
export function defaultVolumeFinder(): VolumeFinder {
  const root = defaultVolumesRoot();
  return process.platform === "darwin" ? volumeFinderAt(root) : lsblkFinder();
}
