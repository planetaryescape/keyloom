// USB serial ports, the way keyloom restarts a ZMK half (D-095): find the CDC ACM port a half exposes and
// "touch" it, which means setting its baud rate and closing it. Listing reads the registry or sysfs and opens
// nothing; only touch() reaches a device. Each platform's listing is in its own file; callers take a
// SerialTransport so tests never touch a keyboard.
import { type PolledOptions, openPolled } from "./polled-file.ts";
import { capture } from "./run.ts";

export type SerialPort = {
  vendorId: number;
  productId: number;
  /** The USB serial number of the device that owns the port, which for a keyloom build carries the build marker. */
  serial?: string;
  /** The node to touch: `/dev/cu.usbmodemN` on macOS (the IOCalloutDevice), a `/dev/serial/by-id` link or `/dev/ttyACMn` on Linux. */
  path: string;
};

/** A serial port held open: bytes from the keyboard arrive in the callback given to open(), and write() sends to it. */
export type SerialSession = {
  write(text: string): Promise<void>;
  close(): Promise<void>;
};

export type SerialTransport = {
  /** Every USB serial port attached, for any vendor. Reading this never opens a device. */
  list(): Promise<SerialPort[]>;
  /** Sets the port's baud rate and closes it. */
  touch(path: string, baud: number): Promise<void>;
  /** Holds the port open to read what the keyboard writes (the typing lab's key stream, D-281). Never changes it to 1200 or 1201 baud. */
  open?(path: string, onData: (bytes: Uint8Array) => void, onError?: (error: Error) => void): Promise<SerialSession>;
};

export class SerialError extends Error {
  override name = "SerialError";
}

/**
 * `stty` opens the port without waiting for carrier, sets the rate and closes it, which is the 1200-baud touch
 * Arduino-style bootloaders listen for. macOS spells the device option `-f`, GNU stty `-F`.
 */
export async function touchWithStty(path: string, baud: number, platform: NodeJS.Platform = process.platform): Promise<void> {
  const r = await capture(["stty", platform === "darwin" ? "-f" : "-F", path, String(baud)], { timeoutMs: 10_000 });
  if (r.exitCode === 0) return;
  const said = (r.stderr || r.stdout).trim();
  if (/permission denied/i.test(said)) {
    throw new SerialError(`no permission to open ${path}${platform === "linux" ? "; add your user to the dialout (or uucp) group and log in again" : ""}`);
  }
  throw new SerialError(`stty could not set ${path} to ${baud} baud${said ? `: ${said}` : r.timedOut ? ": it timed out" : ""}`);
}

/** The rate a lab session runs at. Any rate but 1200 and 1201 is ignored by the keyboard's restart trigger (handsfree.c). */
export const STREAM_BAUD = 115200;

/**
 * `stty raw` first, because a terminal in line mode would hold characters back, rewrite newlines and echo; then the port is held
 * open by this process so closing it later is a close at STREAM_BAUD, which the restart trigger ignores.
 */
export async function openWithStty(path: string, onData: (bytes: Uint8Array) => void, onError?: (error: Error) => void, platform: NodeJS.Platform = process.platform): Promise<SerialSession> {
  const r = await capture(["stty", platform === "darwin" ? "-f" : "-F", path, "raw", "-echo", String(STREAM_BAUD)], { timeoutMs: 10_000 });
  if (r.exitCode !== 0) {
    const said = (r.stderr || r.stdout).trim();
    if (/permission denied/i.test(said)) {
      throw new SerialError(`no permission to open ${path}${platform === "linux" ? "; add your user to the dialout (or uucp) group and log in again" : ""}`);
    }
    throw new SerialError(`stty could not set up ${path}${said ? `: ${said}` : ""}`);
  }
  try {
    const options: PolledOptions = { chunkSize: 256 };
    if (onError) options.onError = onError;
    const file = openPolled(path, onData, options);
    const encoder = new TextEncoder();
    return { write: async (text) => file.write(encoder.encode(text)), close: async () => file.close() };
  } catch (err) {
    throw new SerialError(`could not open ${path}: ${(err as Error).message}`);
  }
}
