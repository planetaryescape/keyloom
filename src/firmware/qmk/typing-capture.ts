// The host half of the Moonlander's key stream (D-281): start it over raw HID, keep it alive, decode the 32-byte reports into a
// trace and stop it. The transport is a parameter, so tests use a fake keyboard and nothing here can reach a real one.
import { WINDOWS_HID_DRIVER_HINT } from "../toolchain/platform-support.ts";
import { CAPTURE_CLOSE_TIMEOUT_MS, CAPTURE_WRITE_TIMEOUT_MS, captureDeadline } from "../emulate/capture-deadline.ts";
import { type CaptureHooks, CaptureError, type CapturedTrace, type KeyCapture, TraceBuilder } from "../emulate/trace.ts";
import type { HidTransport, RawHidInterface } from "../toolchain/hid.ts";
import { ZSA_VENDOR_ID, markerOf } from "./handsfree.ts";
import { KEEPALIVE_MS, decodeTypingReport, typingPacket } from "./typing-stream.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The raw HID interface of the connected ZSA keyboard running a keyloom build, or why there isn't one. */
export async function findQmkStreamDevice(transport: HidTransport): Promise<RawHidInterface> {
  const zsa = (await transport.list()).filter((i) => i.vendorId === ZSA_VENDOR_ID);
  if (zsa.length === 0) throw new CaptureError("no ZSA keyboard is connected");
  // A usable keyloom keyboard wins over another ZSA device whose raw-HID driver failed; the driver hint is only
  // the answer when no usable keyloom keyboard is attached.
  const ours = zsa.filter((i) => !i.driverMissing && markerOf(i.serial) !== undefined);
  if (ours.length === 0 && zsa.some((i) => i.driverMissing)) throw new CaptureError(WINDOWS_HID_DRIVER_HINT);
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
  let closing: Promise<void> | undefined;
  let finishing: Promise<CapturedTrace> | undefined;
  let keepaliveWrite: Promise<void> | undefined;
  let stopping = false;
  const message = (error: unknown) => error instanceof Error ? error.message : "connection unavailable";
  const interrupted = (reason: string) => {
    if (endedBy === undefined || endedBy === "the host asked") endedBy = reason;
    else if (endedBy !== reason) builder.warn(`Recording incomplete: ${reason}`);
    settle(endedBy);
  };

  const end = (reason: string) => {
    if (endedBy !== undefined) return;
    endedBy = reason;
    settle(reason);
  };

  let keepalive: ReturnType<typeof setInterval> | undefined;
  const session = await transport.openSession(
    target,
    (bytes) => {
      if (endedBy !== undefined || closing !== undefined) return;
      const report = decodeTypingReport(bytes);
      if (!report) return;
      if (expected !== undefined && report.seq !== expected) {
        builder.warn(`Recording incomplete: ${(report.seq - expected) & 0xff} report(s) from the keyboard never arrived, so some key events are missing`);
      }
      expected = (report.seq + 1) & 0xff;
      if (report.kind === "status") {
        if (report.on) {
          builder.start(report.deviceMs);
          begun();
        } else end(report.reason ?? "the keyboard stopped the stream");
        return;
      }
      if (report.dropped > 0) builder.warn(`Recording incomplete: the keyboard dropped ${report.dropped} event(s) because it could not send them fast enough`);
      for (const e of report.events) {
        const added = builder.add(e.atMs, e.position, e.pressed);
        if (added) hooks.onEvent?.(added);
      }
    },
    (error) => interrupted(`the connection to the keyboard failed: ${error.message}`),
  );

  const close = () => {
    closing ??= (async () => {
      stopping = true;
      clearInterval(keepalive);
      await captureDeadline(() => session.close(), "close", CAPTURE_CLOSE_TIMEOUT_MS);
    })();
    return closing;
  };

  try {
    await captureDeadline(() => session.write(typingPacket("start")), "START write", CAPTURE_WRITE_TIMEOUT_MS);
    // The firmware ends the stream after 3 s without a START or keepalive, so pinging starts with START, not after the answer.
    keepalive = setInterval(() => {
      if (stopping || endedBy !== undefined || keepaliveWrite) return;
      keepaliveWrite = (async () => {
        try { await captureDeadline(() => session.write(typingPacket("keepalive")), "keepalive write", CAPTURE_WRITE_TIMEOUT_MS); }
        catch (error) { interrupted(`the connection to the keyboard failed: ${message(error)}`); }
      })().finally(() => { keepaliveWrite = undefined; });
    }, hooks.keepaliveMs ?? KEEPALIVE_MS);
    const answered = endedBy === undefined && await Promise.race([started.then(() => true), ended.then(() => false), sleep(hooks.startTimeoutMs ?? 2000).then(() => false)]);
    if (!answered || endedBy !== undefined) {
      const reason = endedBy ? `: ${endedBy}` : "";
      throw new CaptureError(`the keyboard didn't start streaming${reason}. Its firmware may predate the typing lab: apply a change and sync from keyloom to update it, then try again`);
    }
  } catch (thrown) {
    // An interruption the keyboard reported first (framing, a lost connection) is the real reason; a START write that then
    // timed out or failed is only how it surfaced.
    const error = endedBy !== undefined && !message(thrown).includes(endedBy)
      ? new CaptureError(`the keyboard didn't start streaming: ${endedBy}`, { cause: thrown })
      : thrown;
    const cleanupErrors: string[] = [];
    try { await captureDeadline(() => session.write(typingPacket("stop")), "STOP write", CAPTURE_WRITE_TIMEOUT_MS); }
    catch (stopError) { cleanupErrors.push(`STOP failed: ${message(stopError)}`); }
    try { await close(); }
    catch (closeError) { cleanupErrors.push(`the keyboard connection did not close: ${message(closeError)}`); }
    if (cleanupErrors.length > 0) {
      throw new CaptureError(`${message(error)}; cleanup uncertain: ${cleanupErrors.join("; ")}`, { cause: error });
    }
    throw error;
  }


  return {
    snapshot: () => builder.snapshot(),
    ended,
    finish(): Promise<CapturedTrace> {
      finishing ??= (async () => {
        stopping = true;
        clearInterval(keepalive);
        await keepaliveWrite;
        if (endedBy === undefined) {
          try {
            await captureDeadline(() => session.write(typingPacket("stop")), "STOP write", CAPTURE_WRITE_TIMEOUT_MS);
            const acknowledged = await Promise.race([ended.then(() => true), sleep(500).then(() => false)]);
            if (!acknowledged) interrupted("the keyboard did not confirm that recording stopped");
          } catch (error) { interrupted(`the connection to the keyboard failed: ${message(error)}`); }
        }
        try { await close(); }
        catch (error) { interrupted(`the keyboard connection did not close: ${message(error)}`); }
        const events = builder.finish();
        if (endedBy !== undefined && endedBy !== "the host asked") builder.warn(`Recording incomplete: the keyboard ended the stream early: ${endedBy}`);
        return { events, warnings: [...builder.warnings], endedBy: endedBy === "the host asked" ? "host" : endedBy ?? "recording stopped without confirmation" };
      })();
      return finishing;
    },
  };
}
