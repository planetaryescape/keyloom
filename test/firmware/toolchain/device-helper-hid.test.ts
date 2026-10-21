import { beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createHash } from "node:crypto";
import { DeviceTransportClient, DeviceTransportError } from "../../../src/firmware/toolchain/device-helper/transport-client.ts";
import { helperHidTransport } from "../../../src/firmware/toolchain/device-helper/hid.ts";
import { manifestSchema, type HelperManifest } from "../../../src/firmware/toolchain/device-helper/extract.ts";
import { closedSchema, hidDevicesSchema, operationSchema, transportEventSchema, transportIdentitySchema, transportResponseSchema, writtenSchema } from "../../../src/firmware/toolchain/device-helper/transport-protocol.ts";
import { startQmkCapture } from "../../../src/firmware/qmk/typing-capture.ts";
import { encodeEventsReport } from "../../../src/firmware/qmk/typing-stream.ts";
import pkg from "../../../package.json" with { type: "json" };
import canonical from "../../../native/device-helper/protocol/transport-v1.schema.json";
import corpus from "../../fixtures/device-helper/hid-requests.json";
import firmwareReports from "../../fixtures/device-helper/qmk-reports.json";
import { decodeTypingReport } from "../../../src/firmware/qmk/typing-stream.ts";

export function transportContract() {
  const schema = (v: z.ZodType) => z.toJSONSchema(v, { unrepresentable: "any" });
  return { ...schema(z.union([operationSchema, transportResponseSchema, transportEventSchema])), $defs: { identity: schema(transportIdentitySchema), devices: schema(hidDevicesSchema), written: schema(writtenSchema), closed: schema(closedSchema) }, "x-maxFrameBytes": 65536, "x-maxSessions": 8, "x-maxPending": 32, "x-maxDataEvents": 1024 };
}
test("native transport canonical schema and shared adversarial requests", () => {
  expect(JSON.stringify(transportContract())).toBe(JSON.stringify(canonical));
  for (const item of corpus) expect(operationSchema.safeParse(item.request).success).toBe(item.valid);
  for (const item of firmwareReports) expect(decodeTypingReport(Buffer.from(item.report, "base64"))).toMatchObject({ kind: "status", on: item.on, seq: item.seq, deviceMs: 1000 });
});

const binary = process.env.KEYLOOM_TEST_SYNTHETIC_HID;
let manifest: HelperManifest;
let launches = 0;
const children: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>[] = [];
function launch() {
  if (!binary) throw new Error("explicit synthetic-only binary required");
  launches++;
  const child = Bun.spawn([binary, "--stdio"], { env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  children.push(child);
  return child;
}
async function connect() { if (!binary) throw new Error("missing binary"); return DeviceTransportClient.connect(binary, manifest, launch); }
const statsSchema = z.object({ opens: z.number(), writes: z.number() });
const stats = (client: DeviceTransportClient) => client.request("test.stats", {}, statsSchema, 500);
const devices = (client: DeviceTransportClient) => client.request("list", { transport: "hid" }, hidDevicesSchema, 500);
const packet = (byte: number) => Buffer.alloc(32, byte).toString("base64");

test("one-shot HID write allows for lease, rediscovery, open, write and close", async () => {
  const deadlines: Array<[string, number]> = [];
  const fake = {
    request: async (method: string, _params: Record<string, unknown>, _schema: unknown, timeout: number) => {
      deadlines.push([method, timeout]);
      if (method === "list") return { devices: [{ deviceRef: "d1", transport: "hid", vendorId: 1, productId: 2, usagePage: 0xff60, usage: 0x61 }] };
      return { acceptedBytes: 32 };
    },
    open: async () => "s1",
  } as unknown as DeviceTransportClient;
  const transport = helperHidTransport(fake);
  const target = (await transport.list())[0]!;
  await transport.write(target, new Uint8Array(32));
  const session = await transport.openSession!(target, () => {});
  await session.write(new Uint8Array(32));
  expect(deadlines).toEqual([["list", 5_000], ["hid.write", 3_500], ["session.write", 500]]);
});
async function rejectedResult<T>(operation: Promise<T>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("expected transport operation to reject");
}
function expectTransportError(error: unknown, code: DeviceTransportError["detail"]["code"], effect: DeviceTransportError["detail"]["effect"]): void {
  if (!(error instanceof DeviceTransportError)) throw new Error("expected a DeviceTransportError");
  expect(error.detail.code).toBe(code);
  expect(error.detail.effect).toBe(effect);
}

describe.skipIf(!binary)("native synthetic-only HID through real TS client", () => {
  beforeAll(async () => {
    if (!binary) throw new Error("missing binary");
    const child = Bun.spawn([binary, "--version"], { env: {}, stdout: "pipe", stderr: "pipe" });
    const info = transportIdentitySchema.extend({ syntheticBackend: z.literal(true) }).parse(JSON.parse(await new Response(child.stdout).text()));
    expect(await child.exited).toBe(0);
    expect(info.helperVersion).toBe(pkg.version);
    manifest = manifestSchema.parse({ protocol: 1, release: pkg.version, target: info.target, sha256: createHash("sha256").update(await Bun.file(binary).bytes()).digest("hex") });
  });
  test("invalid/stale selectors and malformed reports have zero native effects", async () => {
    const client = await connect();
    try {
      const first = (await devices(client)).devices[0]!;
      await devices(client);
      expectTransportError(await rejectedResult(client.open(first.deviceRef, () => {}, () => {})), "stale_device", "none");
      for (const item of corpus.filter((c) => !c.valid)) {
        const error = await rejectedResult(client.request(item.request.method, item.request.params, z.unknown(), 500));
        expectTransportError(error, "invalid_request", "none");
      }
      expect(await stats(client)).toEqual({ opens: 0, writes: 0 });
    } finally { await client.shutdown(); }
  });
  test("reports preserve a leading zero, exact byte count and concurrent close is idempotent", async () => {
    const client = await connect();
    try {
      const transport = helperHidTransport(client);
      const target = (await transport.list())[0]!;
      const reports: number[][] = [];
      const seen = Promise.withResolvers<void>();
      const session = await transport.openSession!(target, (r) => { reports.push([...r]); seen.resolve(); });
      await session.write(new Uint8Array(32));
      await seen.promise;
      await Promise.all([session.close(), session.close(), session.close()]);
      expect(reports).toEqual([Array(32).fill(0)]);
      expect(await stats(client)).toEqual({ opens: 1, writes: 1 });
      const reopened = await transport.openSession!(target, () => {});
      await reopened.close();
    } finally { await client.shutdown(); }
  });
  test("shared firmware packets cross the native session without byte changes", async () => {
    const client = await connect();
    try {
      const transport = helperHidTransport(client), target = (await transport.list())[0];
      if (!target || !transport.openSession) throw new Error("missing synthetic endpoint");
      const reports: string[] = [];
      const session = await transport.openSession(target, (report) => reports.push(Buffer.from(report).toString("base64")));
      for (const fixture of firmwareReports) await session.write(Buffer.from(fixture.command, "base64"));
      await session.close();
      expect(reports).toEqual(firmwareReports.map((fixture) => fixture.report));
    } finally { await client.shutdown(); }
  });
  test("cross-process lease prevents another helper from opening an active endpoint", async () => {
    const first = await connect(), second = await connect();
    try {
      const a = (await devices(first)).devices[0]!, b = (await devices(second)).devices[0]!;
      const session = await first.open(a.deviceRef, () => {}, () => {});
      await expect(second.open(b.deviceRef, () => {}, () => {})).rejects.toThrow("busy");
      expect(await stats(second)).toEqual({ opens: 0, writes: 0 });
      await first.close(session);
      const reopened = await second.open(b.deviceRef, () => {}, () => {});
      await second.close(reopened);
    } finally { await first.shutdown(); await second.shutdown(); }
  });
  test("failed native write is attempted once and fails the capture", async () => {
    const client = await connect();
    try {
      const target = (await devices(client)).devices[0]!;
      const failed = Promise.withResolvers<Error>();
      const sessionId = await client.open(target.deviceRef, () => {}, failed.resolve);
      expectTransportError(await rejectedResult(client.request("session.write", { sessionId, reportId: 0, bytes: packet(250) }, writtenSchema, 500)), "io_failed", "possible");
      expect((await failed.promise).message).toContain("io_failed");
      await client.close(sessionId);
      expect(await stats(client)).toEqual({ opens: 1, writes: 1 });
    } finally { await client.shutdown(); }
  });
  test("uncertain native close exits the owner instead of acknowledging release", async () => {
    const client = await connect();
    try {
      const target = (await devices(client)).devices[0]!;
      const failure = Promise.withResolvers<Error>();
      const sessionId = await client.open(target.deviceRef, () => {}, failure.resolve);
      await client.request("session.write", { sessionId, reportId: 0, bytes: packet(249) }, writtenSchema, 500);
      await expect(client.close(sessionId)).rejects.toThrow("helper_exited");
      expect((await failure.promise).message).toContain("helper_exited");
      await client.terminate();
    } finally { await client.shutdown(); }
    const next = await connect();
    try {
      const target = (await devices(next)).devices[0]!;
      const id = await next.open(target.deviceRef, () => {}, () => {});
      await next.close(id);
      expect(await stats(next)).toEqual({ opens: 1, writes: 0 });
    } finally { await next.shutdown(); }
  });
  test("lost write response never restarts a helper or repeats the effect", async () => {
    const client = await connect();
    const target = (await devices(client)).devices[0]!;
    const before = launches;
    const sessionId = await client.open(target.deviceRef, () => {}, () => {});
    await expect(client.request("session.write", { sessionId, reportId: 0, bytes: packet(251) }, writtenSchema, 500)).rejects.toThrow();
    await expect(client.request("session.write", { sessionId, reportId: 0, bytes: packet(251) }, writtenSchema, 500)).rejects.toThrow();
    await client.terminate();
    expect(launches).toBe(before);
    expect(await children.at(-1)!.exited).not.toBe(0);
  });
  test("QMK firmware capture keeps device time through the native adapter and reopens", async () => {
    const client = await connect();
    try {
      const transport = helperHidTransport(client), target = (await transport.list())[0]!;
      // Capture owns one session; intercept its writes only to inject a synthetic firmware packet.
      let send: ((bytes: Uint8Array) => void | Promise<void>) | undefined;
      const captureTransport = { ...transport, async openSession(...args: Parameters<NonNullable<typeof transport.openSession>>) {
        const session = await transport.openSession!(...args); send = (bytes: Uint8Array) => session.write(bytes); return session;
      } };
      const capture = await startQmkCapture(captureTransport, target);
      await send!(encodeEventsReport(1, [{ atMs: 1030, position: 4, pressed: true }, { atMs: 1070, position: 4, pressed: false }]));
      const result = await capture.finish();
      expect(result.events).toEqual([{ at: 30, position: 4, action: "press" }, { at: 70, position: 4, action: "release" }]);
      expect(result.endedBy).toBe("host"); expect(result.warnings).toEqual([]);
      const next = await startQmkCapture(transport, target); await next.finish();
    } finally { await client.shutdown(); }
  });
  test("100 owned open/close cycles preserve explicit starts", async () => {
    const client = await connect();
    try {
      const target = (await devices(client)).devices[0]!;
      for (let i = 0; i < 100; i++) { const id = await client.open(target.deviceRef, () => {}, () => {}); await client.close(id); }
      expect(await stats(client)).toEqual({ opens: 100, writes: 0 });
    } finally { await client.shutdown(); }
  }, 15000);
  test.skipIf(process.env.KEYLOOM_TEST_HID_SOAK !== "1")("ten-minute sustained synthetic report stream stays ordered and closes", async () => {
    const client = await connect();
    let reports = 0, writes = 0;
    const before = launches;
    try {
      const transport = helperHidTransport(client);
      const target = (await transport.list())[0];
      if (!target || !transport.openSession) throw new Error("missing synthetic endpoint");
      const session = await transport.openSession(target, () => { reports++; });
      const until = performance.now() + 600_000;
      while (performance.now() < until) { await session.write(new Uint8Array(32)); writes++; await Bun.sleep(50); }
      await session.close();
      expect(reports).toBe(writes);
      expect(writes).toBeGreaterThan(10_000);
      expect(launches).toBe(before);
      console.log(JSON.stringify({ syntheticSoakMs: 600_000, writes, reports, explicitStarts: 1 }));
    } finally { await client.shutdown(); }
  }, 650_000);
});
