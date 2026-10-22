import { requirePlatformSupport } from "./platform-support.ts";
// Which raw HID transport this machine uses. Apart from hid.ts so the platform files can import hid.ts without a cycle.
import { type HidTransport, HidError } from "./hid.ts";
import { deviceBackend } from "./device-helper/selection.ts";

/** The transport for this machine. Refuses unavailable Windows workflows before selecting a transport. */
export async function defaultHidTransport(): Promise<HidTransport> {
  requirePlatformSupport("raw HID");
  if (deviceBackend() === "native" || deviceBackend() === "native-hid") return (await import("./device-helper/owner.ts")).candidateHidTransport();
  if (process.platform === "darwin") return (await import("./hid-macos.ts")).macosHid();
  if (process.platform === "linux") return (await import("./hid-linux.ts")).linuxHid();
  throw new HidError(`keyloom can't talk to a keyboard's raw HID interface on ${process.platform}; use the bootloader key to flash`);
}
