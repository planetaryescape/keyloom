// The host half of the ZMK boards' key stream (D-281): hold the module's serial port open, ask for the stream, parse its lines into a
// trace and stop it. The transport is a parameter, so tests use a fake port and nothing here can reach a real keyboard.
import type { BoardDefinition } from "../../boards/schema.ts";
import { type CaptureHooks, CaptureError, type CapturedTrace, type KeyCapture, TraceBuilder } from "../emulate/trace.ts";
import type { SerialSession, SerialTransport } from "../toolchain/serial.ts";
import { zmkRevision } from "./board-config.ts";
import { halfTargets, portsOfHalf } from "./handsfree-flash.ts";
import { PING_MS, TYPING_PING, TYPING_START, TYPING_STOP, parseStreamLine } from "./typing-stream.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The central half's serial port: it is the half that sees both halves' keys. */
export async function findZmkStreamPort(board: BoardDefinition, transport: SerialTransport): Promise<{ path: string }> {
  const rev = zmkRevision(board);
  const handsFree = rev.flash.handsFree;
  if (!handsFree) throw new CaptureError(`${board.name} has no keyloom module in its firmware recipe, so it can't stream its keys`);
  const central = halfTargets(board, handsFree, rev.flash.steps).find((t) => t.half.role === "central");
  if (!central) throw new CaptureError(`${board.name} has no central half to stream from`);
  const found = portsOfHalf(await transport.list(), central).keyloom;
  if (found.length === 0) {
    throw new CaptureError(`no ${board.name} running keyloom's firmware is connected over USB (its ${central.step.label} must be). Apply a change and sync once from keyloom, then try again`);
  }
  if (found.length > 1) throw new CaptureError(`more than one ${board.name} running keyloom's firmware is connected; unplug the one you don't want to record`);
  return { path: (found[0] as { port: { path: string } }).port.path };
}

export async function startZmkCapture(transport: SerialTransport, path: string, hooks: CaptureHooks = {}): Promise<KeyCapture> {
  if (!transport.open) throw new CaptureError("keyloom can't read a keyboard's serial port on this computer");
  const builder = new TraceBuilder();
  let endedBy: string | undefined;
  let settle: (reason: string) => void = () => {};
  const ended = new Promise<string>((resolve) => (settle = resolve));
  let begun: () => void = () => {};
  const started = new Promise<void>((resolve) => (begun = resolve));
  let pending = "";
  let closed = false;

  const end = (reason: string) => {
    if (endedBy !== undefined) return;
    endedBy = reason;
    settle(reason);
  };

  const handleLine = (line: string) => {
    const parsed = parseStreamLine(line);
    if (!parsed) return;
    if (parsed.kind === "on") {
      builder.start(parsed.deviceMs);
      begun();
    } else if (parsed.kind === "off") end(parsed.reason ?? "the keyboard stopped the stream");
    else if (parsed.kind === "drop") builder.warn(`the keyboard dropped ${parsed.count} event(s) because the port was read too slowly`);
    else {
      const added = builder.add(parsed.deviceMs, parsed.position, parsed.pressed, parsed.source);
      if (added) hooks.onEvent?.(added);
    }
  };

  const session: SerialSession = await transport.open(
    path,
    (text) => {
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    },
    (error) => end(`the connection to the keyboard failed: ${error.message}`),
  );

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    session.close();
  };
  const ping = setInterval(() => {
    try {
      session.write(TYPING_PING);
    } catch (e) {
      end(`the connection to the keyboard failed: ${(e as Error).message}`);
    }
  }, hooks.keepaliveMs ?? PING_MS);

  try {
    session.write(TYPING_START);
    const answered = await Promise.race([started.then(() => true), sleep(hooks.startTimeoutMs ?? 2000).then(() => false)]);
    if (!answered) {
      throw new CaptureError("the keyboard didn't start streaming. Its firmware may predate the typing lab: apply a change and sync from keyloom to update it, then try again");
    }
  } catch (err) {
    try {
      session.write(TYPING_STOP);
    } catch {
      // Closing is what matters now.
    }
    close();
    throw err;
  }

  return {
    snapshot: () => builder.snapshot(),
    ended,
    async finish(): Promise<CapturedTrace> {
      if (endedBy === undefined && !closed) {
        try {
          session.write(TYPING_STOP);
          await Promise.race([ended, sleep(500)]);
        } catch {
          // A keyboard that has gone cannot be told; the trace so far is still good.
        }
      }
      close();
      const events = builder.finish();
      if (endedBy !== undefined && endedBy !== "the host asked") builder.warn(`the keyboard ended the stream early: ${endedBy}`);
      return { events, warnings: [...builder.warnings], endedBy: endedBy === undefined || endedBy === "the host asked" ? "host" : endedBy };
    },
  };
}
