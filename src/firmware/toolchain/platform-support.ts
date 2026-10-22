/** Slice 1 deliberately ships layout editing and diagnostics before Windows device operations. */
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

/** Paths are Commander command names, without arguments. Keep device aliases here too. */
export function requireCommandSupport(command: string, options: { offline?: boolean } = {}, platform: NodeJS.Platform = process.platform): void {
  if (!windowsUnavailable(platform)) return;
  const root = command.split(" ")[0];
  if (["build", "flash", "sync", "autosync", "lab", "remap", "keyboard", "emulate", "serve"].includes(root ?? "")
    || command === "config use" || command === "boards geometry" || (command === "boards check" && !options.offline)) {
    throw new PlatformUnavailableError(`keyloom ${command}`);
  }
}

export function requirePlatformSupport(command: string, platform: NodeJS.Platform = process.platform): void {
  if (windowsUnavailable(platform)) throw new PlatformUnavailableError(command);
}
