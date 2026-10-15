// The native_posix_64 firmware's debug log -> the HID reports it would have sent (06#emulate-runs-zmk-itself-on-the-host-with-a-mock-keyboard). ZMK logs
// every keycode it presses or releases, every change to the modifier byte, and every report it sends
// (the `zmk_endpoints_send_report` line); replaying those against the same slot rules hid.c uses gives
// the reports a host would have seen. With no USB or Bluetooth in the build, the send itself fails with
// "USB endpoint is not supported" after the line this reads, which is expected.
import { EmulationError } from "../emulate/error.ts";
import { CONSUMER_PAGE, KEYBOARD_PAGE, consumerUsageName, keyboardKeyName, modsOf } from "../emulate/hid-usage.ts";
import type { EmulatorReport } from "../emulate/types.ts";

export type ParsedRun = {
  reports: EmulatorReport[];
  warnings: string[];
  /** Real key events the firmware saw, so the caller can tell a run that lost some. */
  eventsSeen: number;
};

export type ParseOptions = {
  /** Positions are columns 0 to keyCount - 1 of the mock keyboard; column keyCount is the harmless first event. */
  keyCount: number;
  /** True when the build used NKRO reports (any number of keys, in usage order) rather than ZMK's six slots. */
  nkro: boolean;
  keyboardSlots?: number;
  consumerSlots?: number;
};

// `[00:00:00.101,000] <dbg> zmk: function: message`; errors and warnings have no function name.
const LINE = /^\[(\d+):(\d\d):(\d\d)\.(\d{3}),(\d{3})\] <(\w+)> zmk: (.*)$/;

const hexOf = (s: string) => Number.parseInt(s, 16);
const isMod = (usage: number) => usage >= 0xe0 && usage <= 0xe7;

/** Errors and warnings every run prints in this build, which say nothing about the layout. */
const EXPECTED = [/^USB endpoint is not supported$/, /^Not found in transform: row: \d+, col: \d+/, /^Have \d+ combos!$/];

export function parseRunLog(lines: readonly string[], opts: ParseOptions): ParsedRun {
  const keySlots: number[] = Array.from({ length: opts.keyboardSlots ?? 6 }, () => 0);
  const nkroKeys = new Set<number>();
  const consumerSlots: number[] = Array.from({ length: opts.consumerSlots ?? 6 }, () => 0);
  let modByte = 0;
  let start: number | undefined;
  let eventsSeen = 0;
  const reports: EmulatorReport[] = [];
  const warnings: string[] = [];
  const warn = (w: string) => {
    if (!warnings.includes(w) && warnings.length < 10) warnings.push(w);
  };

  const place = (slots: number[], usage: number): void => {
    if (slots.includes(usage)) return;
    const free = slots.indexOf(0);
    if (free < 0) warn(`more keys were down at once than ZMK's ${slots.length}-key report holds, so it dropped some presses (NKRO has no limit).`);
    else slots[free] = usage;
  };
  const clear = (slots: number[], usage: number): void => {
    slots.forEach((u, i) => {
      if (u === usage) slots[i] = 0;
    });
  };
  const applyKey = (page: number, usage: number, down: boolean): void => {
    if (page === KEYBOARD_PAGE) {
      // Modifier keys live in the modifier byte, which the "Modifiers set to" lines carry.
      if (isMod(usage)) return;
      if (opts.nkro) down ? nkroKeys.add(usage) : nkroKeys.delete(usage);
      else down ? place(keySlots, usage) : clear(keySlots, usage);
    } else if (page === CONSUMER_PAGE) {
      down ? place(consumerSlots, usage) : clear(consumerSlots, usage);
    } else {
      warn(`a key sent usage page 0x${page.toString(16).toUpperCase()}, which ZMK on a computer has no report for; it was ignored.`);
    }
  };

  const pushReport = (at: number, page: number): void => {
    let report: EmulatorReport;
    if (page === KEYBOARD_PAGE) {
      const keys = opts.nkro ? [...nkroKeys].sort((a, b) => a - b) : keySlots.filter((u) => u !== 0);
      report = { at, kind: "keyboard", mods: modsOf(modByte), keys: keys.map(keyboardKeyName) };
    } else if (page === CONSUMER_PAGE) {
      report = { at, kind: "consumer", usages: consumerSlots.filter((u) => u !== 0).map(consumerUsageName) };
    } else {
      return;
    }
    // Each report differs from the previous one of its kind; the first differs from an empty one.
    const previous = [...reports].reverse().find((r) => r.kind === report.kind);
    const comparable = (r: EmulatorReport) => JSON.stringify({ ...r, at: 0 });
    const empty = report.kind === "keyboard" ? report.mods.length === 0 && report.keys.length === 0 : report.usages.length === 0;
    if (previous === undefined ? !empty : comparable(previous) !== comparable(report)) reports.push(report);
  };

  for (const raw of lines) {
    if (/--- \d+ messages? dropped ---/.test(raw)) {
      throw new EmulationError("the firmware's log overflowed and lost lines, so the reports can't be trusted. Try a shorter key script.");
    }
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const [, h, mi, s, ms, us, level, rest] = m as unknown as [string, string, string, string, string, string, string, string];
    const clock = Math.round((Number(h) * 3600 + Number(mi) * 60 + Number(s)) * 1000 + Number(ms) + Number(us) / 1000);

    if (level === "err" || level === "wrn") {
      if (!EXPECTED.some((re) => re.test(rest))) warn(`the firmware logged ${level === "err" ? "an error" : "a warning"}: ${rest}`);
      continue;
    }
    if (level !== "dbg") continue;
    const fn = /^(\w+): (.*)$/.exec(rest);
    if (!fn) continue;
    const [, name, message] = fn as unknown as [string, string, string];

    if (name.startsWith("kscan_mock_work_handler")) {
      const ev = /^ev \d+ row \d+ column (\d+) state/.exec(message);
      // The unmapped first event only starts the mock's clock; the first real one is time zero.
      if (ev && Number(ev[1]) < opts.keyCount) {
        eventsSeen++;
        start ??= clock;
      }
    } else if (name === "hid_listener_keycode_pressed" || name === "hid_listener_keycode_released") {
      const k = /^usage_page 0x([0-9A-Fa-f]+) keycode 0x([0-9A-Fa-f]+)/.exec(message);
      if (k) applyKey(hexOf(k[1] as string), hexOf(k[2] as string), name.endsWith("pressed"));
      // A key pressed while already down is let go first, with a report of its own.
      const again = /^unregistering usage_page 0x([0-9A-Fa-f]+) keycode 0x([0-9A-Fa-f]+) since it was already pressed/.exec(message);
      if (again) applyKey(hexOf(again[1] as string), hexOf(again[2] as string), false);
    } else if (name === "zmk_endpoints_send_report") {
      const p = /^usage page 0x([0-9A-Fa-f]+)/.exec(message);
      if (p) pushReport(clock - (start ?? clock), hexOf(p[1] as string));
    } else {
      const set = /^Modifiers set to 0x([0-9A-Fa-f]+)/.exec(message);
      if (set) modByte = hexOf(set[1] as string);
    }
  }
  return { reports, warnings, eventsSeen };
}
