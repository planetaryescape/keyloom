import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fakeBinDir } from "../helpers/fake-bin.ts";
import { tempDir } from "../helpers/tmp.ts";

const source = new URL("../../desktop/tauri/scripts/fetch-sidecar.sh", import.meta.url);
const previous = "previous sidecar stays\n";
const payload = "synthetic release payload\n";
const sha = createHash("sha256").update(payload).digest("hex");

function fixture(triple = "aarch64-apple-darwin") {
  const root = tempDir("keyloom-sidecar-");
  const scripts = join(root, "scripts");
  const binaries = join(root, "src-tauri", "binaries");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(binaries, { recursive: true });
  const script = join(scripts, "fetch-sidecar.sh");
  copyFileSync(source, script);
  const asset = triple === "x86_64-apple-darwin" ? "keyloom-darwin-x64" : "keyloom-darwin-arm64";
  const input = join(root, asset);
  const manifest = join(root, "SHA256SUMS");
  const calls = join(root, "curl.calls");
  const dest = join(binaries, `keyloom-${triple}`);
  writeFileSync(input, payload);
  writeFileSync(manifest, `${sha}  ${asset}\n`);
  writeFileSync(calls, "");
  writeFileSync(dest, previous);
  const bin = fakeBinDir({
    rustc: 'printf "host: %s\\n" "$SIDECAR_FAKE_TRIPLE"',
    curl: `dest=''; url=''
while [ "$#" -gt 0 ]; do
  case "$1" in -o) dest="$2"; shift 2 ;; http*) url="$1"; shift ;; *) shift ;; esac
done
printf '%s\\n' "$url" >> "$SIDECAR_FAKE_CALLS"
case "$url" in
  */SHA256SUMS) cp "$SIDECAR_FAKE_SUMS" "$dest"; [ "$SIDECAR_FAKE_FAIL" != manifest ] ;;
  *) cp "$SIDECAR_FAKE_PAYLOAD" "$dest"; [ "$SIDECAR_FAKE_FAIL" != asset ] ;;
esac`,
  });
  const run = (args: string[] = [], env: Record<string, string> = {}) => Bun.spawnSync(["/bin/sh", script, ...args], {
    env: {
      ...process.env, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, KEYLOOM_TAG: "v9.8.7",
      SIDECAR_FAKE_TRIPLE: triple, SIDECAR_FAKE_CALLS: calls, SIDECAR_FAKE_SUMS: manifest,
      SIDECAR_FAKE_PAYLOAD: input, SIDECAR_FAKE_FAIL: "", ...env,
    },
  });
  const unchanged = () => {
    expect(readFileSync(dest, "utf8")).toBe(previous);
    expect(readdirSync(binaries)).toEqual([basename(dest)]);
  };
  return { root, binaries, asset, input, manifest, calls, dest, run, unchanged };
}

test.each(["aarch64-apple-darwin", "x86_64-apple-darwin"])("verifies the exact %s release asset before replacing the sidecar", (triple) => {
  const f = fixture(triple);
  const result = f.run();
  expect(result.exitCode).toBe(0);
  expect(readFileSync(f.dest, "utf8")).toBe(payload);
  expect(statSync(f.dest).mode & 0o111).not.toBe(0);
  expect(readFileSync(f.calls, "utf8").trim().split("\n")).toEqual([
    `https://github.com/planetaryescape/keyloom/releases/download/v9.8.7/${f.asset}`,
    "https://github.com/planetaryescape/keyloom/releases/download/v9.8.7/SHA256SUMS",
  ]);
});

test("rejects corrupt downloaded bytes and preserves the previous sidecar", () => {
  const f = fixture();
  writeFileSync(f.manifest, `${"0".repeat(64)}  ${f.asset}\n`);
  const result = f.run();
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("checksum mismatch");
  f.unchanged();
});

test.each(["missing", "duplicate"])("rejects a %s checksum entry without replacing the sidecar", (kind) => {
  const f = fixture();
  writeFileSync(f.manifest, kind === "missing" ? `${sha}  another-asset\n` : `${sha}  ${f.asset}\n${sha}  ${f.asset}\n`);
  expect(f.run().exitCode).not.toBe(0);
  f.unchanged();
});

test.each(["asset", "manifest"])("cleans up a failed %s download without replacing the sidecar", (part) => {
  const f = fixture();
  expect(f.run([], { SIDECAR_FAKE_FAIL: part }).exitCode).not.toBe(0);
  f.unchanged();
});

test("verifies a local build against its adjacent manifest without downloading", () => {
  const f = fixture();
  const local = join(f.root, "local build");
  mkdirSync(local);
  const input = join(local, "renamed binary");
  copyFileSync(f.input, input);
  copyFileSync(f.manifest, join(local, "SHA256SUMS"));
  expect(f.run([input]).exitCode).toBe(0);
  expect(readFileSync(f.dest, "utf8")).toBe(payload);
  expect(readFileSync(f.calls, "utf8")).toBe("");
});

test("rejects a local build without its manifest", () => {
  const f = fixture();
  unlinkSync(f.manifest);
  expect(f.run([f.input]).exitCode).not.toBe(0);
  f.unchanged();
});

test("rejects changed local bytes without replacing the sidecar", () => {
  const f = fixture();
  writeFileSync(f.input, "changed bytes\n");
  expect(f.run([f.input]).exitCode).not.toBe(0);
  f.unchanged();
});

test("verifies the latest release path as well as an explicit version", () => {
  const f = fixture();
  expect(f.run([], { KEYLOOM_TAG: "latest/download" }).exitCode).toBe(0);
  expect(readFileSync(f.calls, "utf8")).toContain("/releases/latest/download/SHA256SUMS");
});

test("refuses an unsupported target without changing its existing sidecar", () => {
  const f = fixture("aarch64-unknown-linux-gnu");
  expect(f.run().exitCode).not.toBe(0);
  expect(readFileSync(f.calls, "utf8")).toBe("");
  f.unchanged();
});
