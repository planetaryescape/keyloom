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

export type VolumeFinderOptions = {
  /** Only count a directory on a different device from `root`, so a mount point is a volume once it is mounted. Default true. */
  mountedOnly?: boolean;
};

/** Volumes are directories named by label under `root`. */
export function volumeFinderAt(root: string, opts: VolumeFinderOptions = {}): VolumeFinder {
  const base = resolve(root);
  const mountedOnly = opts.mountedOnly ?? true;
  // macOS creates /Volumes/<label> on the system volume about 350 ms before the drive is mounted over it. Taking the bare
  // directory meant writing into it (EACCES) and binding the flash to an identity the mount then replaced (BK's Glove80,
  // 2026-10-22, docs/issues/uf2-mount-point-taken-before-mount.md).
  const isVolume = async (path: string, rootDev: number | undefined): Promise<boolean> => {
    try {
      const st = await stat(path);
      return st.isDirectory() && (!mountedOnly || st.dev !== rootDev);
    } catch {
      return false;
    }
  };
  return async (label) => {
    const rootDev = mountedOnly ? (await stat(base).catch(() => undefined))?.dev : undefined;
    const names = await readdir(base).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return [];
      throw err;
    });
    const matches: string[] = [];
    for (const name of names) {
      // macOS appends a number when another drive with the same label is mounted.
      if (name !== label && !(name.startsWith(`${label} `) && /^\d+$/.test(name.slice(label.length + 1)))) continue;
      const path = join(base, name);
      if (await isVolume(path, rootDev)) matches.push(path);
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
