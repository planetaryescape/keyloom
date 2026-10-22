import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DeviceTransportClient } from "../../../src/firmware/toolchain/device-helper/transport-client.ts";
import { HelperSetupFailure } from "../../../src/firmware/toolchain/device-helper/setup-failure.ts";
import type { HelperChild } from "../../../src/firmware/toolchain/device-helper/spawn.ts";
import { manifestSchema } from "../../../src/firmware/toolchain/device-helper/extract.ts";
import { helperSerialTransport } from "../../../src/firmware/toolchain/device-helper/serial.ts";
import { SERIAL_CAPABILITIES, HID_CAPABILITIES, transportIdentitySchema, operationSchema, serialBytesSchema, serialDevicesSchema, type SessionTransport } from "../../../src/firmware/toolchain/device-helper/transport-protocol.ts";
import { startZmkCapture } from "../../../src/firmware/zmk/typing-capture.ts";
import corpus from "../../fixtures/device-helper/serial-requests.json";
import pkg from "../../../package.json" with { type: "json" };

const manifest = manifestSchema.parse({ release: "0.0.0", protocol: 1, target: "aarch64-apple-darwin", sha256: "0".repeat(64) });
function fake(transport: SessionTransport = "serial", capabilities: readonly string[] = transport === "serial" ? SERIAL_CAPABILITIES : HID_CAPABILITIES) {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  let diagnostics!: ReadableStreamDefaultController<Uint8Array>;
  const exited = Promise.withResolvers<number>();
  let exitCode: number | null = null;
  let seq = 0;
  let attempts = 0;
  let short = false;
  let automatic = false;
  let crash = false;
  let beforeOpen = false;
  const writes: Uint8Array[] = [];
  const touches: { deviceRef: string; baud: number }[] = [];
  const send = (value: unknown) => output.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`));
  const data = (bytes: Uint8Array) => send({ v: 1, type: "event", sessionId: "s1", seq: ++seq, event: "data", receivedAtUs: String(seq), bytes: Buffer.from(bytes).toString("base64") });
  const exit = () => { if (exitCode !== null) return; exitCode = 1; output.close(); diagnostics.close(); exited.resolve(1); };
  const child = {
    stdout: new ReadableStream<Uint8Array>({ start(c) { output = c; } }),
    stderr: new ReadableStream<Uint8Array>({ start(c) { diagnostics = c; } }),
    stdin: {
      write(line: string) {
        const r = JSON.parse(line);
        const reply = (result: unknown) => send({ v: 1, type: "response", id: r.id, ok: true, result });
        if (r.method === "hello") reply({ protocol: 1, helperVersion: manifest.release, target: manifest.target, capabilities });
        else if (r.method === "serial.touch") { touches.push(r.params); reply({ lineStateApplied: true }); }
        else if (r.method === `${transport}.open`) { seq = 0; if (beforeOpen) data(new Uint8Array([0])); reply({ sessionId: "s1" }); }
        else if (r.method === "session.write") {
          const bytes = Buffer.from(r.params.bytes, "base64");
          writes.push(bytes); attempts++;
          if (crash) { exit(); return; }
          reply({ acceptedBytes: short ? bytes.length - 1 : bytes.length });
          if (automatic && bytes.toString() === "KLTYPE START\n") {
            data(Buffer.from("KLTYPE ON 1000\nE 30 1 10"));
            data(Buffer.from("30 255\nE 30 0 1070 255\n"));
          }
          if (automatic && bytes.toString() === "KLTYPE STOP\n") data(Buffer.from("KLTYPE OFF 0\n"));
        } else if (r.method === "session.close") {
          send({ v: 1, type: "event", sessionId: "s1", seq: ++seq, event: "closed", reason: "requested" });
          reply({ finalSeq: seq });
        } else reply({});
      },
      flush: async () => {}, end: () => {},
    },
    exited: exited.promise, get exitCode() { return exitCode; }, signalCode: null, kill: exit,
  } as unknown as HelperChild;
  return { connect: () => DeviceTransportClient.connect("/synthetic", manifest, () => child, transport === "serial" ? SERIAL_CAPABILITIES : HID_CAPABILITIES), data, exit, writes, touches, attempts: () => attempts, short: () => { short = true; }, crash: () => { crash = true; }, beforeOpen: () => { beforeOpen = true; }, firmware: () => { automatic = true; } };
}

test("serial corpus, byte boundaries and metadata are strict", () => {
  for (const baud of [1200, 1201, 115200, -1, 1200.5, "1200"]) {
    expect(operationSchema.safeParse({ v: 1, type: "request", id: "1", method: "serial.touch", params: { deviceRef: "opaque", baud } }).success).toBe(baud === 1200 || baud === 1201);
  }
  for (const item of corpus) expect(operationSchema.safeParse(item.request).success).toBe(item.valid);
  for (const size of [1, 32, 100, 4096]) expect(serialBytesSchema.safeParse(Buffer.alloc(size).toString("base64")).success).toBe(true);
  for (const size of [0, 4097]) expect(serialBytesSchema.safeParse(Buffer.alloc(size).toString("base64")).success).toBe(false);
  for (const bytes of ["AB==", "AA==\n", "AA", "AA==="]) expect(serialBytesSchema.safeParse(bytes).success).toBe(false);
  const device = { deviceRef: "opaque", transport: "serial", vendorId: 0x16c0, productId: 0x27db, serial: "é".repeat(128) };
  expect(serialDevicesSchema.safeParse({ devices: [device] }).success).toBe(true);
  expect(serialDevicesSchema.safeParse({ devices: [{ ...device, serial: "é".repeat(129) }] }).success).toBe(false);
  expect(serialDevicesSchema.safeParse({ devices: [{ ...device, usagePage: 1 }] }).success).toBe(false);
});

test("handshake requires exactly the selected transport capabilities", async () => {
  for (const capabilities of [HID_CAPABILITIES, [...SERIAL_CAPABILITIES, "hid.list"], ["serial.open"]]) {
    const peer = fake("serial", capabilities);
    try { await peer.connect(); throw new Error("expected setup refusal"); }
    catch (error) {
      expect(error).toBeInstanceOf(HelperSetupFailure);
      if (!(error instanceof HelperSetupFailure)) throw error;
      expect(error.original.message).toContain("unsupported");
      expect(error.ownership).toBe("terminated");
    }
  }
});

test("serial data before its open response fails the channel without delivery", async () => {
  const peer = fake(), client = await peer.connect(); peer.beforeOpen();
  let delivered = 0;
  try {
    await expect(client.open("opaque", () => { delivered++; }, () => {}, "serial")).rejects.toThrow("protocol_error");
    expect(delivered).toBe(0);
  } finally { await client.terminate(); }
});

test("serial data preserves arbitrary 32-byte and 4096-byte chunks", async () => {
  const peer = fake(), client = await peer.connect();
  const received: Uint8Array[] = [];
  let seen = Promise.withResolvers<void>();
  try {
    const session = await client.open("opaque", (bytes) => { received.push(bytes); seen.resolve(); }, () => {}, "serial");
    for (const size of [32, 4096]) {
      const bytes = Buffer.alloc(size, 255);
      peer.data(bytes); await seen.promise;
      expect(received.at(-1)).toEqual(bytes);
      seen = Promise.withResolvers<void>();
    }
    await client.close(session);
  } finally { await client.terminate(); }
});

test("serial adapter awaits UTF-8 chunks in order, validates acceptedBytes and maps touch without replay", async () => {
  const peer = fake(), client = await peer.connect(), adapter = helperSerialTransport(client);
  try {
    await adapter.touch("opaque", 1200);
    await adapter.touch("opaque", 1201);
    expect(peer.touches).toEqual([{ deviceRef: "opaque", baud: 1200 }, { deviceRef: "opaque", baud: 1201 }]);
    const session = await adapter.open!("opaque", () => {});
    const text = "a".repeat(4095) + "é" + "x".repeat(4096);
    await Promise.all([session.write(text), session.write("last")]);
    expect(peer.writes.map((b) => b.length)).toEqual([4096, 4096, 1, 4]);
    expect(Buffer.concat(peer.writes.slice(0, 3)).toString()).toBe(text);
    await session.close();
    await expect(session.write("late")).rejects.toThrow("closing");
    expect(peer.attempts()).toBe(4);
  } finally { await client.terminate(); }
});

test("short write receipts fail the channel and queued writes never replay", async () => {
  const peer = fake(), client = await peer.connect(); peer.short();
  try {
    const session = await helperSerialTransport(client).open!("opaque", () => {});
    const results = await Promise.allSettled([session.write("first"), session.write("second")]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(peer.attempts()).toBe(1);
  } finally { await client.terminate(); }
});

test("helper exit after a serial write fails its missing reply once and never replays", async () => {
  const peer = fake(), client = await peer.connect();
  try {
    const session = await helperSerialTransport(client).open!("opaque", () => {});
    peer.crash();
    const results = await Promise.allSettled([session.write("first"), session.write("second")]);
    expect(results.every((r) => r.status === "rejected" && r.reason.message.includes("helper_exited"))).toBe(true);
    expect(peer.attempts()).toBe(1);
  } finally { await client.terminate(); }
});

for (const transport of ["hid", "serial"] as const) {
  test(`${transport} session validates each data size before delivering`, async () => {
    const peer = fake(transport), client = await peer.connect();
    let delivered = 0;
    const failed = Promise.withResolvers<Error>();
    try {
      await client.open("opaque", () => { delivered++; }, failed.resolve, transport);
      peer.data(Buffer.alloc(transport === "hid" ? 100 : 4097));
      expect((await failed.promise).message).toContain("protocol_error");
      expect(delivered).toBe(0);
    } finally { await client.terminate(); }
  });
}

test("chunked serial firmware bytes preserve clocks, complete stop and helper-death incompleteness", async () => {
  for (const interrupted of [false, true]) {
    const peer = fake(), client = await peer.connect(); peer.firmware();
    try {
      const capture = await startZmkCapture(helperSerialTransport(client), "opaque");
      expect(capture.snapshot().map((e) => e.at)).toEqual([30, 70]);
      if (interrupted) { peer.exit(); expect(await capture.ended).toContain("helper_exited"); }
      const trace = await capture.finish();
      expect(trace.events).toHaveLength(2);
      if (interrupted) expect(trace.warnings.some((w) => w.startsWith("Recording incomplete:"))).toBe(true);
      else { expect(trace.endedBy).toBe("host"); expect(trace.warnings).toEqual([]); }
    } finally { await client.terminate(); }
  }
});

const binary = process.env.KEYLOOM_TEST_SYNTHETIC_SERIAL;
describe.skipIf(!binary)("compiled synthetic serial helper", () => {
  test("real child echoes arbitrary chunks and captures START/STOP without OS device code", async () => {
    if (!binary) throw new Error("explicit synthetic helper required");
    const version = Bun.spawn([binary, "--version"], { env: {}, stdout: "pipe", stderr: "pipe" });
    const versionWatchdog = setTimeout(() => version.kill("SIGKILL"), 1_000);
    let info: z.infer<typeof transportIdentitySchema>;
    try {
      info = transportIdentitySchema.extend({ syntheticBackend: z.literal(true) }).parse(JSON.parse(await new Response(version.stdout).text()));
      expect(await version.exited).toBe(0);
      expect(info.capabilities).toEqual([...SERIAL_CAPABILITIES]);
    } finally {
      clearTimeout(versionWatchdog);
      if (version.exitCode === null && version.signalCode === null) version.kill("SIGKILL");
      await version.exited;
    }
    const child = Bun.spawn([binary, "--stdio"], { env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 4_000);
    let client: DeviceTransportClient | undefined;
    try {
      const paired = manifestSchema.parse({ release: pkg.version, protocol: 1, target: info.target, sha256: createHash("sha256").update(await Bun.file(binary).bytes()).digest("hex") });
      client = await DeviceTransportClient.connect(binary, paired, () => child, SERIAL_CAPABILITIES);
      const transport = helperSerialTransport(client);
      const [port] = await transport.list(); expect(port?.serial).toBe("keyloom/NPQRSTVWXYZ0-L");
      const bytes = Promise.withResolvers<Uint8Array>();
      const session = await transport.open!(port!.path, bytes.resolve);
      await session.write("echo é"); expect(Buffer.from(await bytes.promise).toString()).toBe("echo é");
      await session.close();
      const capture = await startZmkCapture(transport, (await transport.list())[0]!.path);
      expect((await capture.finish()).endedBy).toBe("host");
      await client.shutdown(); expect(await child.exited).toBe(0);
    } finally {
      clearTimeout(watchdog);
      if (client) await client.terminate();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await child.exited;
    }
  }, 5_000);
});
