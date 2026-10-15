// What `keyloom emulate` feeds a firmware emulator and what it gets back. The emulators run the real
// firmware logic on this machine (ZMK on native_sim, QMK through its host test harness), so a result
// shows what the keyboard would send over USB for a sequence of key presses.

/** One key event. `position` is the layout's zero-based key index (the editor shows it plus one). */
export type EmulatorEvent = { at: number; position: number; action: "press" | "release" };

/** A keyboard HID report as the host would see it, at `at` ms after the first event. */
export type KeyboardReport = { at: number; kind: "keyboard"; mods: string[]; keys: string[] };
/** A consumer-page report (media keys, brightness), by usage name. */
export type ConsumerReport = { at: number; kind: "consumer"; usages: string[] };
export type EmulatorReport = KeyboardReport | ConsumerReport;

export type EmulationResult = {
  firmware: "qmk" | "zmk";
  /** Reports in order, deduplicated so each differs from the one before. */
  reports: EmulatorReport[];
  /** Best-effort text a text field would show (US layout), for quick reading. */
  text: string;
  /** Behaviours the emulator replaced or couldn't run, in plain words. */
  warnings: string[];
};
