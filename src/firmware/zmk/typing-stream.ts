// The typing lab's key-event stream on ZMK boards (D-281): text lines over the keyloom module's USB serial port, written by
// firmware/zmk/keyloom-zmk/src/typing.c. This file holds the line format both ways so the C and the host cannot drift apart.

export const TYPING_START = "KLTYPE START\n";
export const TYPING_PING = "KLTYPE PING\n";
export const TYPING_STOP = "KLTYPE STOP\n";

/** The stream stops this long after it started, however the host behaves. */
export const SESSION_LIMIT_MS = 10 * 60_000;
/** The stream stops when no start or ping has arrived for this long, so a crashed host ends it. */
export const HOST_QUIET_MS = 3000;
/** The host pings this often, well inside HOST_QUIET_MS. */
export const PING_MS = 1000;

/** ZMK's marker for a key on the half that is running the stream, as opposed to a peripheral's index. */
export const LOCAL_SOURCE = 255;

export const STOP_REASONS = ["the host asked", "the 10 minute limit", "the host stopped answering"] as const;

export type ZmkStreamLine =
  | { kind: "on"; deviceMs: number }
  | { kind: "off"; reason: (typeof STOP_REASONS)[number] | undefined }
  | { kind: "drop"; count: number }
  | { kind: "event"; position: number; pressed: boolean; deviceMs: number; source: number };

const uint = "(\\d{1,10})";
const EVENT = new RegExp(`^E ${uint} ([01]) ${uint} ${uint}$`);
const ON = new RegExp(`^KLTYPE ON ${uint}$`);
const OFF = new RegExp(`^KLTYPE OFF ${uint}$`);
const DROP = new RegExp(`^KLTYPE DROP ${uint}$`);

/** One line from the keyboard, or undefined for anything else (a half-written line after a reconnect, another program's output). */
export function parseStreamLine(line: string): ZmkStreamLine | undefined {
  const text = line.trim();
  const e = EVENT.exec(text);
  if (e) return { kind: "event", position: Number(e[1]), pressed: e[2] === "1", deviceMs: Number(e[3]), source: Number(e[4]) };
  const on = ON.exec(text);
  if (on) return { kind: "on", deviceMs: Number(on[1]) };
  const off = OFF.exec(text);
  if (off) return { kind: "off", reason: STOP_REASONS[Number(off[1])] };
  const drop = DROP.exec(text);
  if (drop) return { kind: "drop", count: Number(drop[1]) };
  return undefined;
}

/** The line the firmware writes for a key, for tests and the fake keyboard. */
export const eventLine = (position: number, pressed: boolean, deviceMs: number, source = LOCAL_SOURCE): string => `E ${position} ${pressed ? 1 : 0} ${deviceMs >>> 0} ${source}\n`;
