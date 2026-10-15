// HID usages as keyloom's key names, so a report reads the same as the layout it came from (an emulator
// sees "keyboard page, usage 0x04"; the layout says "A"). The names are the ones in src/layout/keycodes.ts;
// test/firmware/emulate/hid-usage.test.ts checks every name is one of them.
import type { Mod } from "../../layout/schema.ts";

export const KEYBOARD_PAGE = 0x07;
export const CONSUMER_PAGE = 0x0c;

/** Bit i of a keyboard report's modifier byte. */
export const MOD_BITS: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];

/** The modifier names for the bits set in a report's modifier byte. */
export const modsOf = (byte: number): Mod[] => MOD_BITS.filter((_, i) => (byte & (1 << i)) !== 0);

const KEYBOARD = new Map<number, string>();
const set = (from: number, names: readonly string[]) => names.forEach((n, i) => KEYBOARD.set(from + i, n));
const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

set(0x04, "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
set(0x1e, [...range("N", 1, 9), "N0"]);
set(0x28, [
  "ENTER", "ESCAPE", "BACKSPACE", "TAB", "SPACE", "MINUS", "EQUAL", "LEFT_BRACKET", "RIGHT_BRACKET", "BACKSLASH", "NONUS_HASH", "SEMICOLON",
  "QUOTE", "GRAVE", "COMMA", "DOT", "SLASH", "CAPS_LOCK",
]);
set(0x3a, range("F", 1, 12));
set(0x46, [
  "PRINT_SCREEN", "SCROLL_LOCK", "PAUSE", "INSERT", "HOME", "PAGE_UP", "DELETE", "END", "PAGE_DOWN", "RIGHT", "LEFT", "DOWN", "UP", "NUM_LOCK",
  "KP_SLASH", "KP_ASTERISK", "KP_MINUS", "KP_PLUS", "KP_ENTER",
]);
set(0x59, [...range("KP_", 1, 9), "KP_0", "KP_DOT", "NONUS_BACKSLASH", "APPLICATION", "KB_POWER", "KP_EQUAL"]);
set(0x68, range("F", 13, 24));
set(0x74, [
  "EXECUTE", "HELP", "MENU", "SELECT", "STOP", "AGAIN", "UNDO", "CUT", "COPY", "PASTE", "FIND", "KB_MUTE", "KB_VOLUME_UP", "KB_VOLUME_DOWN",
  "LOCKING_CAPS_LOCK", "LOCKING_NUM_LOCK", "LOCKING_SCROLL_LOCK", "KP_COMMA", "KP_EQUAL_AS400",
]);
set(0x87, [...range("INTERNATIONAL_", 1, 9), ...range("LANGUAGE_", 1, 9)]);
set(0x99, ["ALTERNATE_ERASE", "SYSTEM_REQUEST", "CANCEL", "CLEAR", "PRIOR", "RETURN", "SEPARATOR", "OUT", "OPER", "CLEAR_AGAIN", "CRSEL", "EXSEL"]);
set(0xe0, ["LEFT_CTRL", "LEFT_SHIFT", "LEFT_ALT", "LEFT_GUI", "RIGHT_CTRL", "RIGHT_SHIFT", "RIGHT_ALT", "RIGHT_GUI"]);

const CONSUMER = new Map<number, string>([
  [0x6f, "BRIGHTNESS_UP"], [0x70, "BRIGHTNESS_DOWN"], [0xb3, "MEDIA_FAST_FORWARD"], [0xb4, "MEDIA_REWIND"], [0xb5, "MEDIA_NEXT_TRACK"],
  [0xb6, "MEDIA_PREV_TRACK"], [0xb7, "MEDIA_STOP"], [0xcc, "MEDIA_EJECT"], [0xcd, "MEDIA_PLAY_PAUSE"], [0xe2, "AUDIO_MUTE"], [0xe9, "AUDIO_VOL_UP"],
  [0xea, "AUDIO_VOL_DOWN"], [0x183, "MEDIA_SELECT"], [0x18a, "MAIL"], [0x192, "CALCULATOR"], [0x194, "MY_COMPUTER"], [0x19f, "CONTROL_PANEL"],
  [0x221, "WWW_SEARCH"], [0x223, "WWW_HOME"], [0x224, "WWW_BACK"], [0x225, "WWW_FORWARD"], [0x226, "WWW_STOP"], [0x227, "WWW_REFRESH"],
  [0x22a, "WWW_FAVORITES"], [0x29f, "MISSION_CONTROL"],
]);

const hex = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(2, "0")}`;

/** Keyloom's name for a keyboard-page usage; the raw usage (`KEY_0xF0`) when keyloom has no name for it. */
export const keyboardKeyName = (usage: number): string => KEYBOARD.get(usage) ?? `KEY_${hex(usage)}`;

/** Keyloom's name for a consumer-page usage; the raw usage (`CONSUMER_0x1A3`) when keyloom has no name for it. */
export const consumerUsageName = (usage: number): string => CONSUMER.get(usage) ?? `CONSUMER_${hex(usage)}`;

/** Every keyboard-page name the table knows, for the test that they are all keyloom keys. */
export const knownKeyboardNames = (): string[] => [...KEYBOARD.values()];
export const knownConsumerNames = (): string[] => [...CONSUMER.values()];
