// USB serial ports, the way keyloom restarts a ZMK half (D-095): find the CDC ACM port a half exposes and
// "touch" it, which means setting its baud rate and closing it. Listing reads the registry or sysfs and opens
// nothing; only touch() reaches a device. Each platform's listing is in its own file; callers take a
// SerialTransport so tests never touch a keyboard.
import { capture } from "./run.ts";

export type SerialPort = {
  vendorId: number;
  productId: number;
  /** The USB serial number of the device that owns the port, which for a keyloom build carries the build marker. */
  serial?: string;
  /** The node to touch: `/dev/cu.usbmodemN` on macOS (the IOCalloutDevice), a `/dev/serial/by-id` link or `/dev/ttyACMn` on Linux. */
  path: string;
};

export type SerialTransport = {
  /** Every USB serial port attached, for any vendor. Reading this never opens a device. */
  list(): Promise<SerialPort[]>;
  /** Sets the port's baud rate and closes it. */
  touch(path: string, baud: number): Promise<void>;
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
