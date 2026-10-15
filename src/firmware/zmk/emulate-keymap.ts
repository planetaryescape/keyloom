// The generated keymap -> the keymap ZMK's native_posix_64 build runs (06#emulate). ZMK's own test suite
// does the same: a mock kscan replays key events, and the log says what the firmware did. The board's
// matrix is replaced by one row of keys numbered by position, so a keyloom position is a column and the
// board's real wiring (which the keymap already abstracts away) is left out.
import type { EmulatorEvent } from "../emulate/types.ts";

/** Behaviours that need hardware the host doesn't have, or send nothing a keyboard report carries. */
const UNSUPPORTED = new Map<string, string>([
  ["bt", "Bluetooth"],
  ["out", "output selection"],
  ["rgb_ug", "RGB underglow"],
  ["bl", "backlight"],
  ["ext_power", "external power"],
  ["bootloader", "bootloader"],
  ["sys_reset", "reset"],
  ["soft_off", "soft off"],
  ["studio_unlock", "ZMK Studio unlock"],
  ["mkp", "mouse buttons"],
  ["mmv", "mouse movement"],
  ["msc", "mouse scroll"],
]);

/** Settings that change what the keys do. Anything else in the conf is about hardware (radio, LEDs, sleep) the emulator doesn't have. */
const BEHAVIOUR_SETTINGS = /^CONFIG_ZMK_(COMBO_|MACRO_|HID_REPORT_TYPE_|HID_KEYBOARD_NKRO|BEHAVIOR_|KEYMAP_|MAX_LAYERS)/;

/** The delay before the first real event; the mock's first delay is also the gap to the second (see mockEvents). */
const LEAD_MS = 10;
/** How long the firmware runs after the last event, so timers (tapping terms, sticky keys) can fire. */
export const SETTLE_MS = 2000;
/** The mock packs a delay into 15 bits. */
const MAX_DELAY_MS = 0x7fff;

export class EmulateKeymapError extends Error {
  override name = "EmulateKeymapError";
}

/** The end of the token starting at `i`, where parentheses keep `RGB_COLOR_HSB(0, 100, 100)` whole. */
function tokenEnd(text: string, i: number): number {
  let depth = 0;
  let j = i;
  for (; j < text.length; j++) {
    const ch = text[j] as string;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (/\s/.test(ch) && depth === 0) break;
  }
  return j;
}

/** One cell array's contents with every call to an unsupported behaviour replaced by `&none`, keeping line breaks. */
function neutraliseCells(content: string, found: Map<string, number>): string {
  let out = "";
  let i = 0;
  while (i < content.length) {
    const start = content.indexOf("&", i);
    if (start < 0) break;
    out += content.slice(i, start);
    const nameEnd = tokenEnd(content, start);
    const name = content.slice(start + 1, nameEnd);
    if (!UNSUPPORTED.has(name)) {
      out += content.slice(start, nameEnd);
      i = nameEnd;
      continue;
    }
    // The call's parameters are the tokens up to the next `&`.
    let end = nameEnd;
    for (let j = nameEnd; j < content.length; ) {
      while (j < content.length && /\s/.test(content[j] as string)) j++;
      if (j >= content.length || content[j] === "&") break;
      end = tokenEnd(content, j);
      j = end;
    }
    found.set(name, (found.get(name) ?? 0) + 1);
    out += "&none";
    i = end;
  }
  return out + content.slice(i);
}

/** Replaces the unsupported behaviours in every cell array (`<...>`) of the keymap; returns what it replaced. */
export function neutralise(keymap: string): { keymap: string; replaced: Map<string, number> } {
  const replaced = new Map<string, number>();
  const text = keymap.replace(/<([^<>;{}]*)>/g, (whole, content: string) => (content.includes("&") ? `<${neutraliseCells(content, replaced)}>` : whole));
  return { keymap: text, replaced };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The mock kscan's events. Its delays are odd: event k's delay is the wait before event k+1, and the first
 * event's delay is used twice (before event 0 and before event 1). So a harmless unmapped event goes first,
 * and each real event carries the gap to the next, with the last one carrying the settle time. Zephyr adds a
 * tick to every relative timeout, so each gap is asked for one ms short.
 */
export function mockEvents(events: readonly EmulatorEvent[], keyCount: number, settleMs = SETTLE_MS): string[] {
  const out = [`ZMK_MOCK_RELEASE(0,${keyCount},${LEAD_MS})`];
  events.forEach((e, i) => {
    const next = events[i + 1];
    const gap = next === undefined ? settleMs : Math.max(0, next.at - e.at - 1);
    if (next !== undefined && next.at < e.at) throw new EmulateKeymapError(`events must be in time order, but one at ${next.at} ms follows one at ${e.at} ms`);
    if (gap > MAX_DELAY_MS) throw new EmulateKeymapError(`${next === undefined ? "the settle time" : `the gap after ${e.at} ms`} is ${gap} ms; the emulator's longest wait is ${MAX_DELAY_MS} ms`);
    out.push(`${e.action === "press" ? "ZMK_MOCK_PRESS" : "ZMK_MOCK_RELEASE"}(0,${e.position},${gap})`);
  });
  return out;
}

export type NativeInput = {
  /** The keymap keyloom generated for the real build. */
  keymap: string;
  /** The conf keyloom generated for the real build. */
  conf: string;
  keyCount: number;
  events: readonly EmulatorEvent[];
  settleMs?: number;
};

export type NativeFiles = { keymap: string; conf: string; warnings: string[]; nkro: boolean };

export function nativeFiles(input: NativeInput): NativeFiles {
  if (input.events.length === 0) throw new EmulateKeymapError("there are no key events to run");
  if (input.keyCount >= 255) throw new EmulateKeymapError(`the mock keyboard has at most 254 keys, not ${input.keyCount}`);
  for (const e of input.events) {
    if (!Number.isInteger(e.position) || e.position < 0 || e.position >= input.keyCount) {
      throw new EmulateKeymapError(`key ${e.position + 1} doesn't exist; the board has keys 1 to ${input.keyCount}`);
    }
  }

  const warnings: string[] = [];
  const { keymap: neutral, replaced } = neutralise(input.keymap);
  for (const [name, count] of replaced) {
    warnings.push(`${count} ${plural(count, "binding uses", "bindings use")} &${name} (${UNSUPPORTED.get(name)}), which can't run on a computer; ${plural(count, "it was", "they were")} replaced with &none.`);
  }

  const map = Array.from({ length: input.keyCount }, (_, p) => `RC(0,${p})`).join(" ");
  const overlay = [
    "",
    "// keyloom emulate: the mock keyboard.",
    "#include <dt-bindings/zmk/kscan_mock.h>",
    "#include <dt-bindings/zmk/matrix_transform.h>",
    "/ {",
    "    chosen {",
    "        zmk,matrix-transform = &keyloom_emulate_transform;",
    "    };",
    "",
    "    keyloom_emulate_transform: keyloom_emulate_transform {",
    '        compatible = "zmk,matrix-transform";',
    `        columns = <${input.keyCount}>;`,
    "        rows = <1>;",
    `        map = <${map}>;`,
    "    };",
    "};",
    "",
    "&kscan {",
    `    rows = <1>;`,
    `    columns = <${input.keyCount}>;`,
    "    events = <",
    ...mockEvents(input.events, input.keyCount, input.settleMs).map((e) => `        ${e}`),
    "    >;",
    "};",
    "",
  ].join("\n");

  const kept: string[] = [];
  const dropped: string[] = [];
  for (const raw of input.conf.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("//")) continue;
    const key = /^(CONFIG_[A-Za-z0-9_]+)\s*=/.exec(line)?.[1];
    if (key !== undefined && BEHAVIOUR_SETTINGS.test(key)) kept.push(line);
    else dropped.push(key ?? line);
  }
  if (dropped.length > 0) warnings.push(`${dropped.length} ${plural(dropped.length, "setting wasn't", "settings weren't")} applied, because the emulator applies only the ones that change what keys do (combos, macros, report type): ${dropped.join(", ")}.`);

  return {
    keymap: `${neutral.trimEnd()}\n${overlay}`,
    conf: `${kept.join("\n")}\n`,
    warnings,
    nkro: kept.some((l) => /^CONFIG_ZMK_HID_REPORT_TYPE_NKRO\s*=\s*y$/.test(l)),
  };
}
