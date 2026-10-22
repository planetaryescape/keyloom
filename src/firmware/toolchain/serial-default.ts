// Which serial transport this machine uses. Apart from serial.ts so the platform files can import serial.ts without a cycle.
import { deviceBackend } from "./device-helper/selection.ts";
import { type SerialTransport, SerialError } from "./serial.ts";

/** The transport for this machine. Throws SerialError where keyloom has none (Windows). */
export async function defaultSerialTransport(): Promise<SerialTransport> {
  if (deviceBackend() === "native" || deviceBackend() === "native-serial") return (await import("./device-helper/owner.ts")).candidateSerialTransport();
  if (process.platform === "darwin") return (await import("./serial-macos.ts")).macosSerial();
  if (process.platform === "linux") return (await import("./serial-linux.ts")).linuxSerial();
  throw new SerialError(`keyloom can't restart a keyboard over USB serial on ${process.platform}; use the bootloader key to flash`);
}
