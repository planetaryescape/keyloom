import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { win32 } from "node:path";
import { spawnSync } from "node:child_process";
import { HelperFailure } from "./errors.ts";

type Manifest = { release: string; target: string; sha256: string };
type WindowsFs = Pick<typeof fs, "mkdirSync" | "lstatSync" | "realpathSync" | "openSync" | "writeFileSync" | "closeSync" | "fstatSync" | "readFileSync" | "renameSync" | "unlinkSync">;
const errno = (error: unknown, code: string): boolean => error instanceof Error && "code" in error && error.code === code;
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const aclChecked = new Set<string>();

// Node exposes junctions as symbolic links but not every FILE_ATTRIBUTE_REPARSE_POINT.
// PowerShell's built-in .NET APIs cover those tags and ACLs without an extra native addon.
// Inspect ACLs only on first use in this process; warm launches still inspect attributes
// and hash the final executable. The boundary excludes a malicious same-user process.
function inspectWindowsPaths(paths: string[]): void {
  const script = `
$ErrorActionPreference = 'Stop'
$paths = ConvertFrom-Json $env:KEYLOOM_CACHE_INSPECT
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$trusted = @($me, 'S-1-5-18', 'S-1-5-32-544')
$writes = [System.Security.AccessControl.FileSystemRights]::Write -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership
foreach ($entry in $paths) {
  if (([System.IO.File]::GetAttributes($entry.path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' }
  if ($entry.acl) {
    $acl = Get-Acl -LiteralPath $entry.path
    if ($trusted -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value) { throw 'untrusted owner' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
      if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
      if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $writes) -ne 0 -and $trusted -notcontains $rule.IdentityReference.Value) { throw 'writable by another principal' }
    }
  }
}
`;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new HelperFailure("unsafe_cache");
  const result = spawnSync(win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
  ], {
    env: { ...process.env, KEYLOOM_CACHE_INSPECT: JSON.stringify(paths.map((path) => ({ path, acl: !aclChecked.has(path) }))) },
    windowsHide: true, timeout: 10_000, stdio: "pipe",
  });
  if (result.error || result.status !== 0) throw new HelperFailure("unsafe_cache");
  for (const path of paths) if (!win32.basename(path).startsWith(".publish-")) aclChecked.add(path);
}

/** Injectable filesystem/security boundary lets non-Windows tests exercise refusal and races. */
export function extractWindowsHelper(bytes: Uint8Array, manifest: Manifest, base: string | undefined, io: WindowsFs = fs, inspect = inspectWindowsPaths): string {
  if (!base || !win32.isAbsolute(base)) throw new HelperFailure("unsafe_cache");
  const root = win32.resolve(base);
  const paths = [root];
  // LocalAppData must already exist. Never recursively mkdir through unchecked parents.
  function checkDirectory(path: string): void {
    const stat = io.lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || win32.resolve(io.realpathSync(path)).toLowerCase() !== path.toLowerCase()) throw new HelperFailure("unsafe_cache");
  }
  checkDirectory(root);
  let dir = root;
  const missing: string[] = [];
  for (const part of ["keyloom", "device-helper", manifest.release, manifest.target, manifest.sha256]) {
    dir = win32.join(dir, part);
    if (missing.length > 0) { missing.push(dir); continue; }
    try { checkDirectory(dir); paths.push(dir); }
    catch (error) {
      if (!errno(error, "ENOENT")) throw error;
      missing.push(dir);
    }
  }
  // Inspect existing parents before creating anything below them, including reparse
  // tags which lstat cannot describe. New directories inherit the checked parent ACL.
  inspect(paths);
  for (const path of missing) {
    try { io.mkdirSync(path); }
    catch (error) {
      if (!errno(error, "EEXIST")) throw new HelperFailure("unsafe_cache");
      // Another parent won creation. Check its attributes/ACL before descending.
      inspect([...paths, path]);
    }
    checkDirectory(path);
    paths.push(path);
  }
  const path = win32.join(dir, "keyloom-device.exe");
  function verify(file: string): void {
    const before = io.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || win32.resolve(io.realpathSync(file)).toLowerCase() !== file.toLowerCase()) throw new HelperFailure("unsafe_cache");
    inspect([...paths, file]);
    const fd = io.openSync(file, fs.constants.O_RDONLY);
    try {
      const stat = io.fstatSync(fd);
      if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== bytes.length || digest(io.readFileSync(fd)) !== manifest.sha256) throw new HelperFailure("integrity_error");
    } finally { io.closeSync(fd); }
  }
  let exists = false;
  try { io.lstatSync(path); exists = true; }
  catch (error) { if (!errno(error, "ENOENT")) throw new HelperFailure("unsafe_cache"); }
  if (!exists) {
    const temporary = win32.join(dir, `.publish-${randomUUID()}.exe`);
    try {
      const fd = io.openSync(temporary, "wx");
      try { io.writeFileSync(fd, bytes); } finally { io.closeSync(fd); }
      verify(temporary);
      // Windows can refuse rename when another parent has published/opened the exe.
      // Only accept that race if the winner passes the same complete verification.
      try { io.renameSync(temporary, path); }
      catch (error) {
        if (!["EEXIST", "EPERM", "EACCES", "EBUSY"].some((code) => errno(error, code))) throw error;
        verify(path);
      }
    } finally {
      try { io.unlinkSync(temporary); }
      catch (error) { if (!errno(error, "ENOENT")) throw new HelperFailure("unsafe_cache"); }
    }
  }
  verify(path);
  return path;
}
