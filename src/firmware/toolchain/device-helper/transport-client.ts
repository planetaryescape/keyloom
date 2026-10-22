import { z } from "zod";
import type { HelperManifest } from "./extract.ts";
import { MAX_FRAME } from "./protocol.ts";
import { launchHelper, type HelperChild } from "./spawn.ts";
import { HelperSetupFailure } from "./setup-failure.ts";
import { HID_CAPABILITIES, reportBytesSchema, serialBytesSchema, type Capability, type SessionTransport, closedSchema, openedSchema, transportEventSchema, transportIdentitySchema, transportResponseSchema, type TransportError, type TransportEvent } from "./transport-protocol.ts";

export class DeviceTransportError extends Error {
  constructor(readonly detail: TransportError) { super(`keyboard connection: ${detail.code}`); }
}
const channelError = (code: "protocol_error" | "helper_exited" | "timeout") => new DeviceTransportError({ code, effect: "possible", retry: "never" });
type Pending = { accept(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
type Session = { transport: SessionTransport; seq: number; received: bigint; phase: "open" | "closing" | "failed" | "closed"; failed: boolean; onReport(bytes: Uint8Array): void; onError(error: Error): void; close?: Promise<void> };

/** One child lifetime. There is deliberately no restart, fallback or request replay. */
export class DeviceTransportClient {
  private readonly pending = new Map<string, Pending>();
  private readonly sessions = new Map<string, Session>();
  private readonly closed: string[] = [];
  private id = 0n;
  private failure: Error | undefined;
  private stopping = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private heartbeatPending = false;
  private cleanup: Promise<void> | undefined;
  private readonly listing = new Map<string, Promise<unknown>>();
  private readonly child: HelperChild;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly stderr: ReadableStreamDefaultReader<Uint8Array>;
  private constructor(child: HelperChild) {
    this.child = child;
    this.reader = this.child.stdout.getReader();
    this.stderr = this.child.stderr.getReader();
    void this.read().catch((e: Error) => this.fail(e));
    void this.drain().catch((e: Error) => this.fail(e));
    void this.child.exited.then(() => { if (!this.stopping) this.fail(channelError("helper_exited")); });
  }
  static async connect(path: string, manifest: HelperManifest, launch = launchHelper, expectedCapabilities: readonly Capability[] = HID_CAPABILITIES): Promise<DeviceTransportClient> {
    let child: HelperChild;
    try {
      child = launch(path);
    } catch (e) {
      const original = e instanceof Error ? e : new Error("helper launch failed with a non-Error value", { cause: e });
      throw new HelperSetupFailure(original, "no_child");
    }
    const client = new DeviceTransportClient(child);
    try {
      const identity = await client.request("hello", { protocol: 1, hostVersion: manifest.release, target: manifest.target }, transportIdentitySchema, 2_000);
      if (identity.helperVersion !== manifest.release || identity.target !== manifest.target || identity.protocol !== manifest.protocol) throw new DeviceTransportError({ code: "version_mismatch", effect: "none", retry: "never" });
      if (identity.capabilities.length !== expectedCapabilities.length || !expectedCapabilities.every((c) => identity.capabilities.some((v) => v === c))) throw new DeviceTransportError({ code: "unsupported", effect: "none", retry: "never" });
      client.heartbeat = setInterval(() => {
        if (client.heartbeatPending) return;
        client.heartbeatPending = true;
        void client.request("ping", {}, z.strictObject({}), 1_000).catch((e: Error) => client.fail(e)).finally(() => { client.heartbeatPending = false; });
      }, 1_000);
      return client;
    } catch (e) {
      try {
        await client.terminate();
      } catch (cleanupFailure) {
        const original = e instanceof Error ? e : new Error("helper handshake failed with a non-Error value", { cause: e });
        const cleanup = cleanupFailure instanceof Error ? cleanupFailure : new Error("helper termination failed with a non-Error value", { cause: cleanupFailure });
        throw new HelperSetupFailure(original, "unconfirmed", cleanup);
      }
      const original = e instanceof Error ? e : new Error("helper handshake failed with a non-Error value", { cause: e });
      throw new HelperSetupFailure(original, "terminated");
    }
  }
  request<T>(method: string, params: Record<string, unknown>, schema: z.ZodType<T>, timeout: number, admitted?: (result: T) => void): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 32) return Promise.reject(new DeviceTransportError({ code: "capacity", effect: "none", retry: "never" }));
    const id = String(++this.id);
    const line = `${JSON.stringify({ v: 1, type: "request", id, method, params })}\n`;
    if (Buffer.byteLength(line) > MAX_FRAME) return Promise.reject(channelError("protocol_error"));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(channelError("timeout")), timeout);
      this.pending.set(id, { timer, reject, accept: (value) => {
        const parsed = schema.safeParse(value);
        if (!parsed.success) { this.fail(channelError("protocol_error")); reject(channelError("protocol_error")); return; }
        try { admitted?.(parsed.data); resolve(parsed.data); } catch { this.fail(channelError("protocol_error")); reject(channelError("protocol_error")); }
      } });
      try {
        this.child.stdin.write(line);
        void Promise.resolve(this.child.stdin.flush()).catch(() => this.fail(channelError("helper_exited")));
      } catch { this.fail(channelError("helper_exited")); }
    });
  }
  /** The helper refuses an overlapping list of one transport as busy. Sync polling and a lab start share this client, so lists go one at a time. */
  list<T>(transport: SessionTransport, schema: z.ZodType<T>, timeout: number): Promise<T> {
    const next = (this.listing.get(transport) ?? Promise.resolve()).catch(() => {}).then(() => {
      // A list queued behind shutdown must settle now, not after its timeout once the channel is gone.
      if (this.stopping) throw channelError("helper_exited");
      return this.request("list", { transport }, schema, timeout);
    });
    this.listing.set(transport, next);
    return next;
  }
  async open(deviceRef: string, onReport: (bytes: Uint8Array) => void, onError: (error: Error) => void, transport: SessionTransport = "hid"): Promise<string> {
    const opened = await this.request(`${transport}.open`, { deviceRef }, openedSchema, 2_000, ({ sessionId }) => {
      if (this.sessions.has(sessionId) || this.sessions.size - this.closed.length >= 8) throw channelError("protocol_error");
      this.sessions.set(sessionId, { transport, seq: 0, received: 0n, phase: "open", failed: false, onReport, onError });
    });
    return opened.sessionId;
  }
  close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.reject(channelError("protocol_error"));
    if (session.close) return session.close;
    if (session.phase === "closed") return Promise.resolve();
    if (session.phase === "open") session.phase = "closing";
    session.close = this.request("session.close", { sessionId }, closedSchema, 1_000).then(({ finalSeq }) => {
      if (session.phase !== "closed" || session.seq !== finalSeq) { this.fail(channelError("protocol_error")); throw channelError("protocol_error"); }
    });
    return session.close;
  }
  private event(event: TransportEvent): void {
    const session = this.sessions.get(event.sessionId);
    if (!session || session.phase === "closed" || event.seq !== session.seq + 1) throw channelError("protocol_error");
    session.seq = event.seq;
    if (event.event === "data") {
      if (!(session.transport === "hid" ? reportBytesSchema : serialBytesSchema).safeParse(event.bytes).success) throw channelError("protocol_error");
      const received = BigInt(event.receivedAtUs);
      if (session.failed || received < session.received) throw channelError("protocol_error");
      session.received = received;
      session.onReport(Buffer.from(event.bytes, "base64"));
    } else if (event.event === "failed") {
      if (session.failed) throw channelError("protocol_error");
      session.failed = true; session.phase = "failed";
      session.onError(new DeviceTransportError(event.error));
    } else {
      if ((event.reason === "failed") !== session.failed || (event.reason === "requested" && session.phase !== "closing")) throw channelError("protocol_error");
      session.phase = "closed";
      // Tombstones retain ordering/close receipts, never a recording's callback closure.
      session.onReport = () => {};
      session.onError = () => {};
      this.closed.push(event.sessionId);
      if (this.closed.length > 256) { const old = this.closed.shift(); if (old) this.sessions.delete(old); }
    }
  }
  private async read(): Promise<void> {
    let pending = Buffer.alloc(0);
    for (;;) {
      const chunk = await this.reader.read();
      if (chunk.done) { if (pending.length !== 0) throw channelError("protocol_error"); if (!this.stopping) throw channelError("helper_exited"); return; }
      // Split first: a joined OS read may contain many individually valid frames.
      let start = 0;
      for (let i = 0; i < chunk.value.length; i++) {
        if (chunk.value[i] !== 10) continue;
        const part = chunk.value.subarray(start, i);
        if (pending.length + part.length + 1 > MAX_FRAME) throw channelError("protocol_error");
        const bytes = Buffer.concat([pending, part]); pending = Buffer.alloc(0); start = i + 1;
        let value: unknown;
        try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw channelError("protocol_error"); }
        const response = transportResponseSchema.safeParse(value);
        if (response.success) {
          const request = this.pending.get(response.data.id);
          if (!request) throw channelError("protocol_error");
          this.pending.delete(response.data.id); clearTimeout(request.timer);
          if (response.data.ok) request.accept(response.data.result); else request.reject(new DeviceTransportError(response.data.error));
        } else {
          const event = transportEventSchema.safeParse(value);
          if (!event.success) throw channelError("protocol_error");
          this.event(event.data);
        }
      }
      if (pending.length + chunk.value.length - start >= MAX_FRAME) throw channelError("protocol_error");
      pending = Buffer.concat([pending, chunk.value.subarray(start)]);
    }
  }
  private async drain(): Promise<void> {
    let total = 0;
    for (;;) { const chunk = await this.stderr.read(); if (chunk.done) return; total += chunk.value.length; if (total > MAX_FRAME) throw channelError("protocol_error"); }
  }
  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error; clearInterval(this.heartbeat);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const session of this.sessions.values()) if (session.phase !== "closed" && !session.failed) {
      session.failed = true; session.phase = "failed";
      try { session.onError(error); } catch { /* A consumer cannot prevent sibling failure/cleanup. */ }
      session.onReport = () => {};
      session.onError = () => {};
    }
    void this.terminate().catch(() => { /* Failure remains latched; never start another child. */ });
  }
  async shutdown(): Promise<void> {
    if (this.failure) { await this.terminate(); return; }
    try {
      await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
      clearInterval(this.heartbeat);
      this.stopping = true;
      await this.request("shutdown", {}, z.strictObject({}), 1_000);
      if (await this.waitForExit(1_000) !== 0) throw channelError("helper_exited");
    } catch {
      // Graceful shutdown can fail after the child has already exited; termination is the cleanup receipt.
    }
    await this.terminate();
  }
  private async waitForExit(ms: number): Promise<number> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.child.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(channelError("timeout")), ms); })]); }
    finally { clearTimeout(timer); }
  }
  terminate(): Promise<void> {
    if (this.cleanup) return this.cleanup;
    clearInterval(this.heartbeat);
    this.cleanup = (async () => {
      try { void Promise.resolve(this.child.stdin.end()).catch(() => {}); } catch { /* Broken pipe. */ }
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
      try { await this.waitForExit(2_000); }
      finally { void this.reader.cancel().catch(() => {}); void this.stderr.cancel().catch(() => {}); }
    })();
    return this.cleanup;
  }
}
