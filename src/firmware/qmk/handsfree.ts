// What keyloom adds to a ZSA keyboard's firmware so it can be flashed without a keypress (D-070):
// a build marker in the USB serial number, and a raw-HID command that jumps to the bootloader.
// The firmware side (emitted into the keymap) and the host side (handsfree-flash.ts)
// both read their constants from here so they cannot drift apart.
import { RAW_HID_REPORT_SIZE } from "../toolchain/hid.ts";

/** First byte of the packet. Oryx's commands are 0x00-0x0C and 0xFE, and VIA's are 0x01-0x15 and 0xFF (quantum/via.h), so this is unclaimed. */
export const BOOTLOADER_COMMAND = 0xe7;
/** Eight bytes that must follow the command byte; a stray or buggy packet will not match by accident. */
export const BOOTLOADER_MAGIC = "KLBOOTLD";
export { RAW_HID_REPORT_SIZE } from "../toolchain/hid.ts";

/** ZSA's USB vendor ID, which is what a running Moonlander reports (the bootloader's differs on rev A). */
export const ZSA_VENDOR_ID = 0x3297;

const MARKER_PREFIX = "keyloom/";
const MARKER_ID_LENGTH = 12;

/** The packet that makes keyloom's firmware jump to its bootloader. */
export function bootloaderPacket(): Uint8Array {
  const packet = new Uint8Array(RAW_HID_REPORT_SIZE);
  packet[0] = BOOTLOADER_COMMAND;
  packet.set(new TextEncoder().encode(BOOTLOADER_MAGIC), 1);
  return packet;
}

/**
 * The USB serial number a build carries. A build ID is `bld_` plus a 26-character ULID whose first 10
 * characters are a timestamp; the random tail identifies the build, and keeps the serial short enough
 * for Oryx's firmware-version reply, which copies SERIAL_NUMBER into one 32-byte report (oryx.c,
 * ORYX_CMD_GET_FW_VERSION).
 */
export function buildMarker(buildId: string): string {
  const id = buildId.replace(/^bld_/, "");
  if (!/^[0-9A-Z]{26}$/.test(id)) throw new Error(`"${buildId}" isn't a build ID, so it can't name a firmware build`);
  return `${MARKER_PREFIX}${id.slice(-MARKER_ID_LENGTH)}`;
}

/** The marker inside a firmware file, if it is a hands-free build: Oryx's firmware-version reply keeps SERIAL_NUMBER as a plain string. */
export function markerInFirmware(bytes: Uint8Array): string | undefined {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  return new RegExp(`${MARKER_PREFIX}[0-9A-Z]{${MARKER_ID_LENGTH}}`).exec(text)?.[0];
}

/** Whether `serial` was written by a keyloom build, and which one (as the marker's ID part). */
export function markerOf(serial: string | undefined): string | undefined {
  return serial !== undefined && new RegExp(`^${MARKER_PREFIX}[0-9A-Z]{${MARKER_ID_LENGTH}}$`).test(serial) ? serial : undefined;
}

/** True when `buildId` is the build whose marker `serial` carries. */
export const serialIsBuild = (serial: string | undefined, buildId: string): boolean => markerOf(serial) === buildMarker(buildId);

const cString = (s: string): string => `"${s}"`;

/** The line that replaces any SERIAL_NUMBER in config.h. */
export const serialDefine = (marker: string): string => `#define SERIAL_NUMBER ${cString(marker)}`;

/** Added to rules.mk so the linker routes every call of raw_hid_receive to the wrapper below. */
export const WRAP_LINK_FLAG = "LDFLAGS += -Wl,--wrap=raw_hid_receive";

/** The wrapper must be a separate function the linker can route to; link-time inlining can defeat --wrap, so it is switched off. */
export const NO_LTO = "LTO_ENABLE = no";
export const WRAPPER_SYMBOL = "__wrap_raw_hid_receive";

/**
 * Appended to keymap.c. oryx.c defines raw_hid_receive itself, so the module is left alone: `--wrap`
 * sends the USB code's call to __wrap_raw_hid_receive, which handles the one packet and hands every
 * other to __real_raw_hid_receive, which the linker binds to Oryx's function.
 */
export function wrapperSource(): string {
  const magic = [...new TextEncoder().encode(BOOTLOADER_MAGIC)].map((b) => `'${String.fromCharCode(b)}'`).join(", ");
  return [
    "// keyloom: a raw-HID packet with this command and magic reboots into the bootloader, so keyloom can flash with no keypress.",
    "#include <string.h>",
    `#define KEYLOOM_BOOTLOADER_COMMAND 0x${BOOTLOADER_COMMAND.toString(16)}`,
    `static const uint8_t keyloom_bootloader_magic[] = {${magic}};`,
    "void __real_raw_hid_receive(uint8_t *data, uint8_t length);",
    "void __wrap_raw_hid_receive(uint8_t *data, uint8_t length) {",
    "  if (length > sizeof(keyloom_bootloader_magic) && data[0] == KEYLOOM_BOOTLOADER_COMMAND &&",
    "      memcmp(data + 1, keyloom_bootloader_magic, sizeof(keyloom_bootloader_magic)) == 0) {",
    "    reset_keyboard();",
    "    return;",
    "  }",
    "  __real_raw_hid_receive(data, length);",
    "}",
  ].join("\n");
}
