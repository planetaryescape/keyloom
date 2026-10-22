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
// Ancestors above LocalAppData are checked for the rights that would let another account
// rename one away and substitute a junction: delete, delete-child, change-permissions and
// take-ownership. Creating new entries there (C:\ grants that to Users) is not enough.
function inspectWindowsPaths(paths: string[], ancestors: string[] = []): void {
  const script = `
$ErrorActionPreference = 'Stop'
try {
$paths = ConvertFrom-Json $env:KEYLOOM_CACHE_INSPECT
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$trusted = @($me, 'S-1-5-18', 'S-1-5-32-544')
$trustedInstaller = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$rename = [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership
$writes = [System.Security.AccessControl.FileSystemRights]::Write -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership
foreach ($entry in $paths) {
  if (([System.IO.File]::GetAttributes($entry.path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "reparse point: $($entry.path)" }
  if ($entry.acl) {
    # .NET directly: Get-Acl needs a module, which fails to load when PowerShell 7 launched us.
    $sections = [System.Security.AccessControl.AccessControlSections]'Access,Owner'
    $acl = if ([System.IO.Directory]::Exists($entry.path)) { [System.IO.DirectoryInfo]::new($entry.path).GetAccessControl($sections) } else { [System.IO.FileInfo]::new($entry.path).GetAccessControl($sections) }
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    $owners = if ($entry.ancestor) { $trusted + $trustedInstaller } else { $trusted }
    if ($owners -notcontains $owner) { throw "untrusted owner $owner of $($entry.path)" }
    $mask = if ($entry.ancestor) { $rename } else { $writes }
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
      if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
      if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $mask) -ne 0 -and $owners -notcontains $rule.IdentityReference.Value) { throw "writable by $($rule.IdentityReference.Value) ($($rule.FileSystemRights)): $($entry.path)" }
    }
  }
}
} catch {
  # Plain text on stdout: redirected PowerShell stderr is CLIXML, not the reason.
  [Console]::Out.WriteLine($_.Exception.Message)
  exit 1
}
`;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new HelperFailure("unsafe_cache");
  const started = Date.now();
  const result = spawnSync(win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
  ], {
    // PowerShell 7's PSModulePath breaks Windows PowerShell 5.1's module loading.
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PSMODULEPATH")), KEYLOOM_CACHE_INSPECT: JSON.stringify([
      ...ancestors.map((path) => ({ path, acl: !aclChecked.has(path), ancestor: true })),
      ...paths.map((path) => ({ path, acl: !aclChecked.has(path), ancestor: false })),
    ]) },
    // Cold Windows PowerShell start can take several seconds on a busy machine; this runs once per process.
    windowsHide: true, timeout: 30_000, stdio: "pipe",
  });
  if (result.error || result.status !== 0) {
    // The script prints its reason on stdout; anything PowerShell itself raised is CLIXML on stderr.
    const stdout = result.stdout?.toString("utf8").split(/\r?\n/).find((line) => line.trim() !== "")?.trim();
    const stderr = [...(result.stderr?.toString("utf8") ?? "").matchAll(/<S S="Error">([^<]*)<\/S>/g)].map((m) => m[1]).join("").replaceAll("_x000D__x000A_", " ").trim();
    const said = result.error?.message ?? (stdout || stderr || undefined);
    throw new HelperFailure("unsafe_cache", `powershell exit ${result.status ?? result.signal} after ${Date.now() - started} ms${said ? `: ${said}` : ""}`.slice(0, 300));
  }
  for (const path of [...ancestors, ...paths]) if (!win32.basename(path).startsWith(".publish-")) aclChecked.add(path);
}

/** Injectable filesystem/security boundary lets non-Windows tests exercise refusal and races. */
export function extractWindowsHelper(bytes: Uint8Array, manifest: Manifest, base: string | undefined, io: WindowsFs = fs, inspect: (paths: string[], ancestors?: string[]) => void = inspectWindowsPaths): string {
  if (!base || !win32.isAbsolute(base)) throw new HelperFailure("unsafe_cache");
  const root = win32.resolve(base);
  const ancestors: string[] = [];
  for (let up = win32.dirname(root); up !== ancestors.at(-1) && up !== root; up = win32.dirname(up)) ancestors.push(up);
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
  inspect(paths, ancestors);
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
