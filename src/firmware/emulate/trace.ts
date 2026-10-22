// A recorded stretch of typing as the keyboard's firmware saw it (D-281): physical presses and releases with millisecond times,
// before any tap or hold decision. It is the same shape an emulator is given, so a trace replays through the real firmware logic
// as it is. The capture readers (qmk/typing-capture.ts, zmk/typing-capture.ts) build one with a TraceBuilder.
import type { EmulatorEvent } from "./types.ts";

/** An emulator event plus where it came from: ZMK numbers its peripherals, and 255 is the central itself. QMK has no sources. */
export type TraceEvent = EmulatorEvent & { source?: number | undefined };

export type CapturedTrace = {
  /** In time order, from the first key's press at the keyboard's clock reading when the stream began (so the lead-in is kept). */
  events: TraceEvent[];
  /** Things the person should know before trusting the trace: lost reports, repaired keys, why the stream ended early. */
  warnings: string[];
  /** "host" when the capture was ended from this side, else why the keyboard ended it. */
  endedBy: string;
};

// QMK's legacy warnings are from 994911d; ZMK's unprefixed drop and early-end warnings are from b475178^ (also 3bf16e4^).
const LEGACY_INCOMPLETE_WARNINGS = [
  /^\d+ report\(s\) from the keyboard never arrived(?:,|$)/,
  /^the keyboard dropped \d+ event\(s\)(?: |$)/,
  /^the keyboard ended the stream early:/,
];

/** Persisted warning marker, shared by analysis refusal and CLI summaries. */
export const incompleteRecording = (warnings: readonly string[]): boolean => warnings.some((warning) =>
  warning.startsWith("Recording incomplete:") || LEGACY_INCOMPLETE_WARNINGS.some((pattern) => pattern.test(warning)),
);

export type KeyCapture = {
  /** The events so far, in order. */
  snapshot(): TraceEvent[];
  /** Settles with the reason when the keyboard (or the connection) ends the stream before finish() is called. */
  ended: Promise<string>;
  /** Asks the keyboard to stop, waits briefly for it to say so, closes the connection and returns the trace. Safe to call twice. */
  finish(): Promise<CapturedTrace>;
};

export type CaptureHooks = {
  onEvent?: (event: TraceEvent) => void;
  /** How long to wait for the keyboard to say the stream began. Firmware without the lab never answers. */
  startTimeoutMs?: number;
  /** How often to tell the keyboard the host is still there. */
  keepaliveMs?: number;
};

export class CaptureError extends Error {
  override name = "CaptureError";
}

const WRAP = 2 ** 32;

/** Collects events from a 32-bit millisecond clock, which wraps every 49 days, into a trace that starts at the clock's reading at the start. */
export class TraceBuilder {
  private readonly events: TraceEvent[] = [];
  readonly warnings: string[] = [];
  private origin: number | undefined;
  private lastRaw: number | undefined;
  private wraps = 0;
  private readonly down = new Set<number>();

  /** The clock reading when the stream began; later events are measured from it. */
  start(deviceMs: number): void {
    this.origin = this.unwrap(deviceMs);
  }

  private unwrap(deviceMs: number): number {
    const raw = deviceMs >>> 0;
    if (this.lastRaw !== undefined && raw < this.lastRaw && this.lastRaw - raw > WRAP / 2) this.wraps++;
    this.lastRaw = raw;
    return raw + this.wraps * WRAP;
  }

  warn(text: string): void {
    if (!this.warnings.includes(text)) this.warnings.push(text);
  }

  /** Adds a key event and returns it, or undefined when it cannot be right (a press of a key already down, a release of one not down). */
  add(deviceMs: number, position: number, pressed: boolean, source?: number): TraceEvent | undefined {
    if (this.origin === undefined) this.origin = this.unwrap(deviceMs);
    const at = Math.max(0, this.unwrap(deviceMs) - this.origin);
    if (pressed === this.down.has(position)) {
      this.warn(`key ${position + 1} was reported ${pressed ? "pressed while already down" : "released while not down"}; that report was left out`);
      return undefined;
    }
    if (pressed) this.down.add(position);
    else this.down.delete(position);
    const event: TraceEvent = { at, position, action: pressed ? "press" : "release", ...(source === undefined ? {} : { source }) };
    this.events.push(event);
    return event;
  }

  snapshot(): TraceEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  /** Lets go of keys still down when the stream stopped, so a replay does not leave a key stuck. */
  finish(): TraceEvent[] {
    const last = this.events.at(-1)?.at ?? 0;
    for (const position of [...this.down]) {
      this.warn(`key ${position + 1} was still down when the recording stopped; it was let go at the end`);
      this.events.push({ at: last, position, action: "release" });
    }
    this.down.clear();
    return this.snapshot();
  }
}
