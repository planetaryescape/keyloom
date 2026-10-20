import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync, fchmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { z } from "zod";
import { HelperFailure } from "./errors.ts";

export const manifestSchema = z.strictObject({
  release: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/),
  protocol: z.literal(1),
  target: z.enum(["aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-unknown-linux-musl", "x86_64-pc-windows-msvc"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type HelperManifest = z.infer<typeof manifestSchema>;

export function currentTarget(): string {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin";
  if (process.platform === "darwin" && process.arch === "x64") return "x86_64-apple-darwin";
  if (process.platform === "linux" && process.arch === "x64") return "x86_64-unknown-linux-musl";
  throw new HelperFailure("helper_unavailable");
}

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const errno = (error: unknown, code: string): boolean => error instanceof Error && "code" in error && error.code === code;
const uid = (): number => {
  if (!process.getuid) throw new HelperFailure("helper_unavailable");
  return process.getuid();
};

function directory(path: string, privateMode: boolean): void {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (!errno(error, "EEXIST")) throw new HelperFailure("unsafe_cache"); }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid()
    || (stat.mode & (privateMode ? 0o077 : 0o022)) !== 0) throw new HelperFailure("unsafe_cache");
}

// Canonicalize OS aliases such as macOS /var -> /private/var, but never accept a symlink
// in the managed subtree. Shared sticky system temp ancestors are not managed directories.
function cacheBase(path: string): string {
  if (!isAbsolute(path)) throw new HelperFailure("unsafe_cache");
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (parent !== absolute) {
    try { lstatSync(parent); }
    catch (error) {
      if (!errno(error, "ENOENT")) throw new HelperFailure("unsafe_cache");
      cacheBase(parent);
    }
  }
  directory(absolute, false);
  const canonical = realpathSync(absolute);
  let ancestor = dirname(canonical);
  while (ancestor !== parse(ancestor).root) {
    const stat = lstatSync(ancestor);
    const stickyRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== 0 && stat.uid !== uid())
      || ((stat.mode & 0o022) !== 0 && !stickyRoot)) throw new HelperFailure("unsafe_cache");
    ancestor = dirname(ancestor);
  }
  return canonical;
}

function verifyFile(path: string, manifest: HelperManifest, size: number): void {
  let fd: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== uid() || (before.mode & 0o777) !== 0o700)
      throw new HelperFailure("unsafe_cache");
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== size || digest(readFileSync(fd)) !== manifest.sha256)
      throw new HelperFailure("integrity_error");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** No runtime executable override. Tests supply bytes/cache explicitly, never a production path. */
export function extractHelper(bytes: Uint8Array, rawManifest: unknown, release: string, base?: string): { path: string; manifest: HelperManifest } {
  const parsed = manifestSchema.safeParse(rawManifest);
  if (!parsed.success) throw new HelperFailure("version_mismatch");
  const manifest = parsed.data;
  if (manifest.release !== release || manifest.target !== currentTarget()) throw new HelperFailure("version_mismatch");
  if (digest(bytes) !== manifest.sha256) throw new HelperFailure("integrity_error");
  let dir = cacheBase(base ?? (process.env.XDG_CACHE_HOME || join(homedir(), ".cache")));
  dir = join(dir, "keyloom");
  directory(dir, false); // Existing general keyloom cache can be 0755.
  for (const part of ["device-helper", manifest.release, manifest.target, manifest.sha256]) {
    dir = join(dir, part);
    directory(dir, true);
  }
  const path = join(dir, "keyloom-device");
  try {
    lstatSync(path);
  } catch (error) {
    if (!errno(error, "ENOENT")) throw error;
    const temporary = join(dir, `.publish-${randomUUID()}`);
    try {
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o700);
      try {
        writeFileSync(fd, bytes);
        fchmodSync(fd, 0o700);
      } finally { closeSync(fd); }
      verifyFile(temporary, manifest, bytes.length);
      // Atomic no-replace publication: concurrent parents never replace another parent's executable.
      try { linkSync(temporary, path); }
      catch (publishError) { if (!errno(publishError, "EEXIST")) throw publishError; }
    } finally {
      try { unlinkSync(temporary); }
      catch (cleanupError) { if (!errno(cleanupError, "ENOENT")) throw cleanupError; }
    }
  }
  verifyFile(path, manifest, bytes.length);
  return { path, manifest };
}
