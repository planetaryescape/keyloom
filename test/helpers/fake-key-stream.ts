// Fake keyboards for the typing lab (D-281): they speak the firmware's stream protocol, QMK's raw HID reports and ZMK's serial
// lines, so the host readers, the lab's CLI and its tests run end to end without a device. Nothing here can reach a real keyboard.
import { TYPING_ACTION, TYPING_COMMAND, encodeEventsReport, encodeStatusReport, type TypingEvent } from "../../src/firmware/qmk/typing-stream.ts";
import { ZSA_VENDOR_ID } from "../../src/firmware/qmk/handsfree.ts";
import { eventLine } from "../../src/firmware/zmk/typing-stream.ts";
import type { HidSession, HidTransport, RawHidInterface } from "../../src/firmware/toolchain/hid.ts";
import type { SerialPort, SerialSession, SerialTransport } from "../../src/firmware/toolchain/serial.ts";

export type FakeStream<Wire> = {
  /** What the host wrote, in order. */
  written: Wire[];
  opened: () => number;
  closed: () => number;
};

export const KEYLOOM_SERIAL = "keyloom/NPQRSTVWXYZ0";
export const moonlanderInterface = (serial: string | undefined = KEYLOOM_SERIAL): RawHidInterface => ({ vendorId: ZSA_VENDOR_ID, productId: 0x1969, handle: "fake-hid-1", ...(serial ? { serial } : {}) });

export type FakeMoonlander = {
  transport: HidTransport;
  stream: FakeStream<Uint8Array>;
  /** Sends events the way the firmware batches them: up to five per report, each report numbered. */
  press(events: readonly TypingEvent[], opts?: { dropped?: number }): void;
  /** Skips a report number, as a lost USB report would. */
  loseReport(): void;
  /** The keyboard ends the stream by itself. */
  stopBy(reasonIndex: number): void;
  /** The connection fails. */
  fail(message: string): void;
  isOn(): boolean;
};

/** A Moonlander running keyloom's firmware. `answers: false` is firmware from before the lab, which ignores the start. */
export function fakeMoonlander(opts: { answers?: boolean; clockMs?: number; interfaces?: RawHidInterface[] } = {}): FakeMoonlander {
  const written: Uint8Array[] = [];
  let opened = 0;
  let closed = 0;
  let seq = 0;
  let on = false;
  let sink: ((r: Uint8Array) => void) | undefined;
  let onError: ((e: Error) => void) | undefined;
  const clock = opts.clockMs ?? 1_000_000;
  const send = (r: Uint8Array) => queueMicrotask(() => sink?.(r));

  const transport: HidTransport = {
    list: async () => opts.interfaces ?? [moonlanderInterface()],
    write: async () => {
      throw new Error("the fake keyboard has no one-shot write");
    },
    openSession: async (_target, onReport, onErr) => {
      opened++;
      sink = onReport;
      onError = onErr;
      const session: HidSession = {
        write(report) {
          written.push(new Uint8Array(report));
          if (report[0] !== TYPING_COMMAND || opts.answers === false) return;
          const action = report[9];
          if (action === TYPING_ACTION.start && !on) {
            on = true;
            send(encodeStatusReport(seq++, true, clock));
          } else if (action === TYPING_ACTION.stop && on) {
            on = false;
            send(encodeStatusReport(seq++, false, clock + 1, 0));
          }
        },
        close() {
          closed++;
          sink = undefined;
        },
      };
      return session;
    },
  };
  return {
    transport,
    stream: { written, opened: () => opened, closed: () => closed },
    press(events, o = {}) {
      for (let i = 0; i < events.length; i += 5) send(encodeEventsReport(seq++, events.slice(i, i + 5), i === 0 ? (o.dropped ?? 0) : 0));
    },
    loseReport() {
      seq++;
    },
    stopBy(reasonIndex) {
      on = false;
      send(encodeStatusReport(seq++, false, clock + 5, reasonIndex));
    },
    fail(message) {
      onError?.(new Error(message));
    },
    isOn: () => on,
  };
}

export const glovePort = (serial = "keyloom/NPQRSTVWXYZ0-L:GLV80-0123456789ABCDEF", path = "/fake/cu.usbmodem1"): SerialPort => ({ vendorId: 0x16c0, productId: 0x27db, serial, path });

export type FakeGlove = {
  transport: SerialTransport;
  stream: FakeStream<string>;
  /** Writes serial bytes to the host in chunks, which may split UTF-8 characters or line endings. */
  say(text: string, chunk?: number): void;
  sayBytes(bytes: Uint8Array, chunk?: number): void;
  press(events: ReadonlyArray<{ position: number; pressed: boolean; ms: number; source?: number }>): void;
  stopBy(reason: number): void;
  fail(message: string): void;
  releasePendingWrite(): void;
  isOn(): boolean;
};

export function fakeGlove(opts: {
  answers?: boolean; ports?: SerialPort[]; clockMs?: number; chunkBytes?: number;
  rejectWrite?: "start" | "ping" | "stop"; pendingWrite?: "ping"; rejectClose?: boolean; neverOff?: boolean;
} = {}): FakeGlove {
  const written: string[] = [];
  let opened = 0;
  let closed = 0;
  let on = false;
  let sink: ((bytes: Uint8Array) => void) | undefined;
  let onError: ((error: Error) => void) | undefined;
  let releasePending: (() => void) | undefined;
  const clock = opts.clockMs ?? 5000;
  const sayBytes = (bytes: Uint8Array, chunk = opts.chunkBytes ?? (bytes.length || 1)) => {
    for (let i = 0; i < bytes.length; i += chunk) {
      const piece = bytes.slice(i, i + chunk);
      queueMicrotask(() => sink?.(piece));
    }
  };
  const say = (text: string, chunk?: number) => sayBytes(new TextEncoder().encode(text), chunk);
  const transport: SerialTransport = {
    list: async () => opts.ports ?? [glovePort()],
    touch: async () => {
      throw new Error("the fake keyboard must never be touched");
    },
    open: async (_path, onData, onErr) => {
      opened++;
      sink = onData;
      onError = onErr;
      const session: SerialSession = {
        async write(text) {
          written.push(text);
          const action = text === "KLTYPE START\n" ? "start" : text === "KLTYPE PING\n" ? "ping" : text === "KLTYPE STOP\n" ? "stop" : undefined;
          if (opts.rejectWrite === action) throw new Error(`synthetic ${action} write failure`);
          if (opts.pendingWrite === action) await new Promise<void>((resolve) => { releasePending = resolve; });
          if (opts.answers === false) return;
          if (text === "KLTYPE START\n" && !on) {
            on = true;
            say(`KLTYPE ON ${clock}\n`);
          } else if (text === "KLTYPE STOP\n" && on) {
            on = false;
            if (!opts.neverOff) say("KLTYPE OFF 0\n");
          }
        },
        async close() {
          closed++;
          sink = undefined;
          if (opts.rejectClose) throw new Error("synthetic close failure");
        },
      };
      return session;
    },
  };
  return {
    transport,
    stream: { written, opened: () => opened, closed: () => closed },
    say,
    sayBytes,
    press(events) {
      for (const e of events) say(eventLine(e.position, e.pressed, clock + e.ms, e.source));
    },
    stopBy(reason) {
      on = false;
      say(`KLTYPE OFF ${reason}\n`);
    },
    fail(message) { onError?.(new Error(message)); },
    releasePendingWrite() { releasePending?.(); releasePending = undefined; },
    isOn: () => on,
  };
}
