import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { diagnoseHelper } from "../../../src/firmware/toolchain/device-helper/client.ts";
import { DeviceTransportError, DeviceTransportClient } from "../../../src/firmware/toolchain/device-helper/transport-client.ts";
import { extractForSetup } from "../../../src/firmware/toolchain/device-helper/hid.ts";
import { HelperSetupFailure } from "../../../src/firmware/toolchain/device-helper/setup-failure.ts";
import { HelperFailure } from "../../../src/firmware/toolchain/device-helper/errors.ts";
import { currentTarget, extractHelper, type HelperManifest } from "../../../src/firmware/toolchain/device-helper/extract.ts";
import { helloSchema, identitySchema, MAX_FRAME, requestSchema, responseSchema } from "../../../src/firmware/toolchain/device-helper/protocol.ts";
import { launchHelper } from "../../../src/firmware/toolchain/device-helper/spawn.ts";
import corpus from "../../fixtures/device-helper/requests.json";
import canonical from "../../../native/device-helper/protocol/v1.schema.json";
import { tempDir } from "../../helpers/tmp.ts";

const bytes = new TextEncoder().encode("synthetic executable bytes");
const manifest = (): HelperManifest => ({
  release: "0.45.0", protocol: 1, target: process.platform === "win32" ? "x86_64-pc-windows-msvc" : target(),
  sha256: createHash("sha256").update(bytes).digest("hex"),
});
function target(): HelperManifest["target"] {
  const value = currentTarget();
  if (value === "aarch64-apple-darwin" || value === "x86_64-apple-darwin" || value === "x86_64-unknown-linux-musl") return value;
  throw new Error("unexpected test target");
}

test("canonical schema is the generated diagnostics envelope contract", () => {
  const generated = {
    ...z.toJSONSchema(z.union([requestSchema, responseSchema]), { unrepresentable: "any" }),
    $defs: { helloParams: z.toJSONSchema(helloSchema), helloResult: z.toJSONSchema(identitySchema) },
    "x-maxFrameBytes": MAX_FRAME, "x-maxRequestId": "18446744073709551615",
  };
  expect(JSON.stringify(generated)).toBe(JSON.stringify(canonical));
});

test("shared adversarial corpus validates the TS wire boundary", () => {
  for (const item of corpus) expect(requestSchema.safeParse(item.request).success).toBe(item.envelopeValid);
});

test("production launch is blocked by the no-real-device preload", () => {
  expect(() => launchHelper("/not/a/real/helper")).toThrow("real device helper is blocked");
});

describe.skipIf(process.platform === "win32")("private Unix extraction", () => {
  test("cold/warm extraction accepts spaces/non-ASCII and an existing 0755 general cache", () => {
    const base = join(tempDir(), "cache space é");
    mkdirSync(base);
    mkdirSync(join(base, "keyloom"), { mode: 0o755 });
    const m = manifest();
    const first = extractHelper(bytes, m, m.release, base);
    expect(readFileSync(first.path)).toEqual(Buffer.from(bytes));
    expect(lstatSync(first.path).mode & 0o777).toBe(0o700);
    expect(extractHelper(bytes, m, m.release, base).path).toBe(first.path);
    expect(extractHelper(bytes, { ...m, release: "0.44.0" }, "0.44.0", base).path).not.toBe(first.path);
  });

  test("corrupt embedded/cache bytes and mismatched release/target fail closed", () => {
    const base = tempDir();
    const m = manifest();
    expect(() => extractHelper(Uint8Array.of(1), m, m.release, base)).toThrow("integrity_error");
    expect(() => extractHelper(bytes, m, "0.44.0", base)).toThrow("version_mismatch");
    expect(() => extractHelper(bytes, { ...m, target: "wrong" }, m.release, base)).toThrow("version_mismatch");
    const pair = extractHelper(bytes, m, m.release, base);
    writeFileSync(pair.path, "corrupt");
    expect(() => extractHelper(bytes, m, m.release, base)).toThrow("integrity_error");
  });

  test("symlinked helper/release/cache and permissive directories/files are refused", () => {
    const m = manifest();
    const base = tempDir();
    const pair = extractHelper(bytes, m, m.release, base);
    chmodSync(pair.path, 0o755);
    expect(() => extractHelper(bytes, m, m.release, base)).toThrow("unsafe_cache");
    const symlinkBase = join(tempDir(), "linked");
    symlinkSync(base, symlinkBase);
    expect(() => extractHelper(bytes, m, m.release, symlinkBase)).toThrow("unsafe_cache");
    const other = tempDir();
    mkdirSync(join(other, "keyloom"), { mode: 0o700 });
    symlinkSync(base, join(other, "keyloom", "device-helper"));
    expect(() => extractHelper(bytes, m, m.release, other)).toThrow("unsafe_cache");
    const permissive = tempDir();
    chmodSync(permissive, 0o777);
    expect(() => extractHelper(bytes, m, m.release, permissive)).toThrow("unsafe_cache");
  });

  test("a symlink at the final executable is never followed", () => {
    const m = manifest();
    const base = tempDir();
    const dir = join(base, "keyloom", "device-helper", m.release, m.target, m.sha256);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const outside = join(tempDir(), "outside");
    writeFileSync(outside, bytes);
    chmodSync(outside, 0o700);
    symlinkSync(outside, join(dir, "keyloom-device"));
    expect(() => extractHelper(bytes, m, m.release, base)).toThrow("unsafe_cache");
    expect(readFileSync(outside)).toEqual(Buffer.from(bytes));
  });
});

test.skipIf(process.platform !== "win32")("Windows production extraction is explicitly unavailable pending private ACL proof", () => {
  expect(() => extractHelper(bytes, manifest(), "0.45.0", tempDir())).toThrow(HelperFailure);
});

function synthetic(mode = "valid") {
  const script = join(tempDir(), "child.ts");
  writeFileSync(script, `
const mode = ${JSON.stringify(mode)};
let pending = "";
for await (const chunk of Bun.stdin.stream()) {
  pending += new TextDecoder().decode(chunk);
  let end;
  while ((end = pending.indexOf("\\n")) >= 0) {
    const request = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
    if (mode === "hang") continue;
    if (mode === "wrongjson") { process.stdout.write("[]\\n"); continue; }
    if (mode === "utf8") { process.stdout.write(Uint8Array.of(255, 10)); continue; }
    if (mode === "crash") process.exit(0);
    if (mode === "stderr") { process.stderr.write("secret-synthetic".repeat(6000)); continue; }
    if (mode === "oversize") { process.stdout.write("x".repeat(65537)); continue; }
    const result = request.method === "hello"
      ? {protocol:1,helperVersion:request.params.hostVersion,target:request.params.target,capabilities:[]}
      : {};
    if (mode === "version" && request.method === "hello") result.helperVersion = "wrong";
    if (mode === "caps" && request.method === "hello") result.capabilities = ["hid.open"];
    const object = {v:1,type:"response",id:mode === "stale" ? "99" : request.id,ok:true,result};
    const response = JSON.stringify(mode === "order" ? Object.fromEntries(Object.entries(object).reverse()) : object).replace(mode === "proto" ? '{"v":1' : "never-matches", '{"__proto__":{"polluted":true},"v":1') + "\\n";
    if (mode === "fragment") for (const c of response) process.stdout.write(c);
    else process.stdout.write(response);
    if (request.method === "shutdown") {
      if (mode === "late") process.stdout.write("{}\\n");
      if (mode === "noexit") { setInterval(() => {}, 1000); } else process.exit(0);
    }
  }
}
`);
  const children: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>[] = [];
  return {
    children,
    launch: () => {
      const child = Bun.spawn([process.execPath, script], { env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      children.push(child);
      return child;
    },
  };
}

test("packaged-helper verification failure is explicitly confirmed to have spawned no child", () => {
  let failure: unknown;
  try { extractForSetup(bytes, { ...manifest(), sha256: "f".repeat(64) }, manifest().release); }
  catch (error) { failure = error; }
  if (!(failure instanceof HelperSetupFailure)) throw new Error("verification failure must record no-child ownership");
  expect(failure.ownership).toBe("no_child");
  expect(failure.original).toBeInstanceOf(HelperFailure);
});

test("transport setup reports confirmed termination only after the failed handshake child exits", async () => {
  const script = join(tempDir(), "handshake-child.ts");
  writeFileSync(script, `
for await (const chunk of Bun.stdin.stream()) {
  const request = JSON.parse(new TextDecoder().decode(chunk).trim());
  process.stdout.write(JSON.stringify({v:1,type:"response",id:request.id,ok:true,result:{protocol:1,helperVersion:"wrong",target:request.params.target,capabilities:["hid.list","hid.open","hid.write"]}})+"\\n");
}
`);
  const child = Bun.spawn([process.execPath, script], { env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let failure: unknown;
  try {
    await DeviceTransportClient.connect("/synthetic", manifest(), () => child);
  } catch (error) { failure = error; }
  if (!(failure instanceof HelperSetupFailure)) throw new Error("failed handshake must include its cleanup receipt");
  expect(failure.ownership).toBe("terminated");
  expect(failure.original).toBeInstanceOf(DeviceTransportError);
  expect(failure.cleanupFailure).toBeUndefined();
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
});

test("parallel independent handshakes accept fragmented/reordered metadata without prototype pollution", async () => {
  for (const mode of ["fragment", "order", "proto"]) {
    const fake = synthetic(mode);
    const results = await Promise.all(Array.from({ length: 8 }, () => diagnoseHelper("/synthetic", manifest(), fake.launch)));
    expect(results.every((r) => r.capabilities.length === 0)).toBe(true);
    expect(fake.children.every((p) => p.exitCode === 0)).toBe(true);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  }
});

for (const [mode, code] of [
  ["version", "version_mismatch"], ["caps", "protocol_error"], ["stale", "protocol_error"],
  ["crash", "helper_exited"], ["oversize", "protocol_error"], ["stderr", "protocol_error"],
  ["late", "protocol_error"], ["wrongjson", "protocol_error"], ["utf8", "protocol_error"],
  ["hang", "timeout"], ["noexit", "timeout"],
]) {
  test(`client refuses ${mode} and observes child exit`, async () => {
    const fake = synthetic(mode);
    const started = Date.now();
    await expect(diagnoseHelper("/synthetic", manifest(), fake.launch)).rejects.toThrow(code);
    expect(Date.now() - started).toBeLessThan(4500);
    expect(fake.children.every((p) => p.exitCode !== null || p.signalCode !== null)).toBe(true);
  }, 6000);
}
