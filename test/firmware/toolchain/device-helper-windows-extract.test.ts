import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { win32, join } from "node:path";
import { extractWindowsHelper } from "../../../src/firmware/toolchain/device-helper/extract-windows.ts";
import { currentTarget } from "../../../src/firmware/toolchain/device-helper/extract.ts";
import { tempDir } from "../../helpers/tmp.ts";

const bytes = Buffer.from("synthetic diagnostics executable");
const manifest = { release: "0.49.0", target: "x86_64-pc-windows-msvc", sha256: createHash("sha256").update(bytes).digest("hex") };

function fixture() {
  const root = tempDir();
  const map = (p: fs.PathLike): string => join(root, String(p).replace(/^C:\\/i, "").replaceAll("\\", "/"));
  const base = "C:\\Users\\test space é\\AppData\\Local";
  fs.mkdirSync(map(base), { recursive: true });
  const io = {
    mkdirSync: ((p: fs.PathLike) => fs.mkdirSync(map(p))) as typeof fs.mkdirSync,
    lstatSync: ((p: fs.PathLike) => fs.lstatSync(map(p))) as typeof fs.lstatSync,
    realpathSync: ((p: fs.PathLike) => String(p)) as typeof fs.realpathSync,
    openSync: ((p: fs.PathLike, flags: fs.OpenMode) => fs.openSync(map(p), flags)) as typeof fs.openSync,
    writeFileSync: fs.writeFileSync, closeSync: fs.closeSync, fstatSync: fs.fstatSync, readFileSync: fs.readFileSync,
    renameSync: ((a: fs.PathLike, b: fs.PathLike) => fs.renameSync(map(a), map(b))) as typeof fs.renameSync,
    unlinkSync: ((p: fs.PathLike) => fs.unlinkSync(map(p))) as typeof fs.unlinkSync,
  };
  return { io, base, map };
}

test("Windows target and LocalAppData path preserve spaces/Unicode and coexist by version", () => {
  expect(currentTarget("win32", "x64")).toBe(manifest.target);
  expect(() => currentTarget("win32", "arm64")).toThrow("helper_unavailable");
  const { io, base } = fixture();
  const inspect = () => {};
  const path = extractWindowsHelper(bytes, manifest, base, io, inspect);
  expect(path).toBe(win32.join(base, "keyloom", "device-helper", manifest.release, manifest.target, manifest.sha256, "keyloom-device.exe"));
  expect(extractWindowsHelper(bytes, manifest, base, io, inspect)).toBe(path);
  expect(extractWindowsHelper(bytes, { ...manifest, release: "0.48.0" }, base, io, inspect)).not.toBe(path);
});

test("every warm extraction rehashes the cached exe", () => {
  const { io, base, map } = fixture();
  const path = extractWindowsHelper(bytes, manifest, base, io, () => {});
  fs.writeFileSync(map(path), Buffer.alloc(bytes.length));
  expect(() => extractWindowsHelper(bytes, manifest, base, io, () => {})).toThrow("integrity_error");
});

test("missing/relative LocalAppData, junctions, redirected paths and ACL/reparse refusal fail closed", () => {
  const { io, base } = fixture();
  for (const bad of [undefined, "relative"]) expect(() => extractWindowsHelper(bytes, manifest, bad, io, () => {})).toThrow("unsafe_cache");
  const stat = io.lstatSync;
  io.lstatSync = ((p: fs.PathLike) => Object.assign(stat(p), { isSymbolicLink: () => true })) as typeof fs.lstatSync;
  expect(() => extractWindowsHelper(bytes, manifest, base, io, () => {})).toThrow("unsafe_cache");
  io.lstatSync = stat;
  expect(() => extractWindowsHelper(bytes, manifest, base, io, () => { throw new Error("unsafe_cache"); })).toThrow("unsafe_cache");
  io.realpathSync = Object.assign(() => "C:\\elsewhere", { native: fs.realpathSync.native }) as unknown as typeof fs.realpathSync;
  expect(() => extractWindowsHelper(bytes, manifest, base, io, () => {})).toThrow("unsafe_cache");
});

test("a concurrent locked winner is verified, corrupt winners and unexplained locks refuse", () => {
  const { io, base, map } = fixture();
  io.renameSync = (from, to) => {
    fs.copyFileSync(map(from), map(to));
    throw Object.assign(new Error("locked winner"), { code: "EPERM" });
  };
  expect(extractWindowsHelper(bytes, manifest, base, io, () => {})).toEndWith("keyloom-device.exe");
  const other = fixture();
  other.io.renameSync = (_from, to) => {
    fs.writeFileSync(other.map(to), "wrong");
    throw Object.assign(new Error("locked winner"), { code: "EACCES" });
  };
  expect(() => extractWindowsHelper(bytes, manifest, other.base, other.io, () => {})).toThrow("integrity_error");
});

test("a final executable link and a lock without a published winner are refused", () => {
  const { io, base } = fixture();
  extractWindowsHelper(bytes, manifest, base, io, () => {});
  const lstat = io.lstatSync;
  io.lstatSync = ((p: fs.PathLike) => {
    const stat = lstat(p);
    return String(p).endsWith("keyloom-device.exe") ? Object.assign(stat, { isSymbolicLink: () => true }) : stat;
  }) as typeof fs.lstatSync;
  expect(() => extractWindowsHelper(bytes, manifest, base, io, () => {})).toThrow("unsafe_cache");
  const locked = fixture();
  locked.io.renameSync = () => { throw Object.assign(new Error("locked without winner"), { code: "EPERM" }); };
  expect(() => extractWindowsHelper(bytes, manifest, locked.base, locked.io, () => {})).toThrow();
  const dir = win32.join(locked.base, "keyloom", "device-helper", manifest.release, manifest.target, manifest.sha256);
  expect(fs.readdirSync(locked.map(dir))).toEqual([]);
});

test.skipIf(process.platform !== "win32")("native Windows refuses directory junctions without following them", () => {
  const base = tempDir();
  const outside = tempDir();
  fs.symlinkSync(outside, join(base, "keyloom"), "junction");
  expect(() => extractWindowsHelper(bytes, manifest, base)).toThrow("unsafe_cache");
  expect(fs.readdirSync(outside)).toEqual([]);
});

test.skipIf(process.platform !== "win32")("native Windows refuses a cache writable by Everyone", () => {
  const base = tempDir();
  const script = `$acl = Get-Acl -LiteralPath $env:KEYLOOM_TEST_ACL; $sid = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'); $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:KEYLOOM_TEST_ACL -AclObject $acl`;
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { env: { ...process.env, KEYLOOM_TEST_ACL: base } });
  expect(result.exitCode).toBe(0);
  expect(() => extractWindowsHelper(bytes, manifest, base)).toThrow("unsafe_cache");
  expect(fs.readdirSync(base)).toEqual([]);
});

test("ancestors above LocalAppData are inspected for replacement rights, up to the drive root", () => {
  const { io, base } = fixture();
  const seen: string[][] = [];
  extractWindowsHelper(bytes, manifest, base, io, (_paths, ancestors = []) => { if (ancestors.length) seen.push(ancestors); });
  expect(seen).toEqual([["C:\\Users\\test space é\\AppData", "C:\\Users\\test space é", "C:\\Users", "C:\\"]]);
  const refused = fixture();
  expect(() => extractWindowsHelper(bytes, manifest, refused.base, refused.io, (_paths, ancestors = []) => {
    if (ancestors.includes("C:\\Users")) throw new Error("unsafe_cache: writable by S-1-1-0 (Delete): C:\\Users");
  })).toThrow("unsafe_cache");
});

test.skipIf(process.platform !== "win32")("native Windows refuses a cache whose parent another account can rename away", () => {
  const parent = tempDir();
  const base = join(parent, "Local");
  fs.mkdirSync(base);
  // Delete on the parent itself (no inheritance), so the cache directory's own ACL stays clean.
  const script = `$acl = Get-Acl -LiteralPath $env:KEYLOOM_TEST_ACL; $sid = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'); $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'Delete', 'None', 'None', 'Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:KEYLOOM_TEST_ACL -AclObject $acl`;
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { env: { ...process.env, KEYLOOM_TEST_ACL: parent } });
  expect(result.exitCode).toBe(0);
  expect(() => extractWindowsHelper(bytes, manifest, base)).toThrow("writable by S-1-1-0");
  expect(fs.readdirSync(base)).toEqual([]);
});
