// The host half of the Moonlander's key stream (D-281): start it over raw HID, keep it alive, decode the 32-byte reports into a
// trace and stop it. The transport is a parameter, so tests use a fake keyboard and nothing here can reach a real one.
import { type CaptureHooks, CaptureError, type CapturedTrace, type KeyCapture, TraceBuilder } from "../emulate/trace.ts";
import type { HidTransport, RawHidInterface } from "../toolchain/hid.ts";
import { ZSA_VENDOR_ID, markerOf } from "./handsfree.ts";
import { KEEPALIVE_MS, decodeTypingReport, typingPacket } from "./typing-stream.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The raw HID interface of the connected ZSA keyboard running a keyloom build, or why there isn't one. */
export async function findQmkStreamDevice(transport: HidTransport): Promise<RawHidInterface> {
  const zsa = (await transport.list()).filter((i) => i.vendorId === ZSA_VENDOR_ID);
  if (zsa.length === 0) throw new CaptureError("no ZSA keyboard is connected");
  const ours = zsa.filter((i) => markerOf(i.serial) !== undefined);
  if (ours.length === 0) {
    throw new CaptureError("the connected ZSA keyboard isn't running a keyloom build, so it can't stream its keys. Apply a change and sync once from keyloom, then try again");
  }
  if (ours.length > 1) throw new CaptureError("more than one keyboard running keyloom's firmware is connected; unplug the one you don't want to record");
  return ours[0] as RawHidInterface;
}

export async function startQmkCapture(transport: HidTransport, target: RawHidInterface, hooks: CaptureHooks = {}): Promise<KeyCapture> {
  if (!transport.openSession) throw new CaptureError("keyloom can't read a keyboard's raw HID reports on this computer");
  const builder = new TraceBuilder();
  let endedBy: string | undefined;
  let settle: (reason: string) => void = () => {};
  const ended = new Promise<string>((resolve) => (settle = resolve));
  let begun: () => void = () => {};
  const started = new Promise<void>((resolve) => (begun = resolve));
  let expected: number | undefined;
  let closed = false;

  const end = (reason: string) => {
    if (endedBy !== undefined) return;
    endedBy = reason;
    settle(reason);
  };

  const session = await transport.openSession(
    target,
    (bytes) => {
      const report = decodeTypingReport(bytes);
      if (!report) return;
      if (expected !== undefined && report.seq !== expected) {
        builder.warn(`${(report.seq - expected) & 0xff} report(s) from the keyboard never arrived, so some key events are missing`);
      }
      expected = (report.seq + 1) & 0xff;
      if (report.kind === "status") {
        if (report.on) {
          builder.start(report.deviceMs);
          begun();
        } else end(report.reason ?? "the keyboard stopped the stream");
        return;
      }
      if (report.dropped > 0) builder.warn(`the keyboard dropped ${report.dropped} event(s) because it could not send them fast enough`);
      for (const e of report.events) {
        const added = builder.add(e.atMs, e.position, e.pressed);
        if (added) hooks.onEvent?.(added);
      }
    },
    (error) => end(`the connection to the keyboard failed: ${error.message}`),
  );

  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    await session.close();
  };
  const keepalive = setInterval(() => {
    try {
      void Promise.resolve(session.write(typingPacket("keepalive"))).catch((e: Error) => end(`the connection to the keyboard failed: ${e.message}`));
    } catch (e) {
      end(`the connection to the keyboard failed: ${(e as Error).message}`);
    }
  }, hooks.keepaliveMs ?? KEEPALIVE_MS);

  try {
    await session.write(typingPacket("start"));
    const answered = await Promise.race([started.then(() => true), sleep(hooks.startTimeoutMs ?? 2000).then(() => false)]);
    if (!answered) {
      throw new CaptureError("the keyboard didn't start streaming. Its firmware may predate the typing lab: apply a change and sync from keyloom to update it, then try again");
    }
  } catch (err) {
    try {
      await session.write(typingPacket("stop"));
    } catch {
      // The write that failed is why we are here; closing is what matters.
    }
    await close();
    throw err;
  }

  return {
    snapshot: () => builder.snapshot(),
    ended,
    async finish(): Promise<CapturedTrace> {
      if (endedBy === undefined && !closed) {
        try {
          await session.write(typingPacket("stop"));
          await Promise.race([ended, sleep(500)]);
        } catch {
          // A keyboard that has gone cannot be told; the trace so far is still good.
        }
      }
      await close();
      const events = builder.finish();
      if (endedBy !== undefined && endedBy !== "the host asked") builder.warn(`the keyboard ended the stream early: ${endedBy}`);
      return { events, warnings: [...builder.warnings], endedBy: endedBy === undefined || endedBy === "the host asked" ? "host" : endedBy };
    },
  };
}
