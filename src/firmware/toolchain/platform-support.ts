import { deviceBackend } from "./device-helper/selection.ts";

/** Ordinary Windows releases remain diagnostics-only; only an explicit compiled candidate admits devices. */
export const WINDOWS_ROADMAP = "https://github.com/planetaryescape/keyloom/blob/main/docs/blueprint/13-roadmap.md#rung-24f-i-can-use-the-device-helper-on-native-windows";

export class PlatformUnavailableError extends Error {
  readonly code = "platform_unavailable";
  constructor(readonly command: string) {
    super(`${command} is not available on Windows yet. See ${WINDOWS_ROADMAP}`);
    this.name = "PlatformUnavailableError";
  }
}

export function windowsUnavailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}

export function windowsDevicesUnavailable(platform: NodeJS.Platform = process.platform, backend = deviceBackend()): boolean {
  return windowsUnavailable(platform) && backend !== "native";
}

/** Paths are Commander command names, without arguments. Keep device aliases here too. */
export function requireCommandSupport(command: string, options: { offline?: boolean; rebootOnly?: boolean } = {}, platform: NodeJS.Platform = process.platform, backend = deviceBackend()): void {
  if (!windowsUnavailable(platform)) return;
  const root = command.split(" ")[0];
  if (!windowsDevicesUnavailable(platform, backend) && (root === "lab" || (command === "flash" && options.rebootOnly))) return;
  if (["build", "flash", "sync", "autosync", "lab", "remap", "keyboard", "emulate", "serve"].includes(root ?? "")
    || command === "workload evaluate" || command === "workload compare"
    || command === "config use" || command === "boards geometry" || (command === "boards check" && !options.offline)) {
    throw new PlatformUnavailableError(`keyloom ${command}`);
  }
}

export function requirePlatformSupport(command: string, platform: NodeJS.Platform = process.platform): void {
  if (!windowsUnavailable(platform)) return;
  if (!windowsDevicesUnavailable(platform) && ["raw HID", "serial", "keyloom lab start", "keyloom flash --reboot-only"].includes(command)) return;
  throw new PlatformUnavailableError(command);
}

export const WINDOWS_HID_DRIVER_HINT = "unsupported: the USB keyboard has no usable in-box HID interface. Check its driver status in Device Manager and the firmware's QMK raw HID collection (usage page 0xFF60, usage 0x61). Keep the Windows keyboard driver.";
export const WINDOWS_COM_DRIVER_HINT = "unsupported: the USB keyboard has no usable USB CDC COM interface. Check its driver status in Device Manager and whether its firmware exposes CDC for the in-box usbser.sys driver.";
export const WINDOWS_BUSY_HINT = "busy: another application or keyloom instance holds the COM port. Close the serial monitor or other client, then try again.";
