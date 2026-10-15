// The harness's output lines to the contract's reports (05#emulate). Pure, so it is tested without Docker.
import type { ConsumerReport, EmulatorReport, KeyboardReport } from "../emulate/types.ts";
import { fromQmk } from "../../layout/keycodes.ts";

/** HID modifier byte, bit 0 first. */
const MOD_BITS = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"] as const;

export type ParsedOutput = { reports: EmulatorReport[]; warnings: string[] };

const keyloomName = (qmkName: string, unknown: Set<string>): string => {
  const info = fromQmk(qmkName);
  if (info) return info.name;
  unknown.add(qmkName);
  return qmkName;
};

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Lines are `K <ms> <mods hex> <QMK key name>...`, `C <ms> <QMK key name>` and `M <ms> <buttons hex>`
 * (emulate-harness.ts). Keys are sorted, so two reports with the same keys in a different slot order
 * compare equal, and a report that repeats the one before it is dropped.
 */
export function parseHarnessOutput(output: string): ParsedOutput {
  const reports: EmulatorReport[] = [];
  const unknown = new Set<string>();
  let mouse = false;
  let lastKeyboard: KeyboardReport = { at: 0, kind: "keyboard", mods: [], keys: [] };
  let lastConsumer: ConsumerReport = { at: 0, kind: "consumer", usages: [] };

  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const [kind, at] = parts;
    if (!kind || at === undefined || !/^\d+$/.test(at)) continue;
    if (kind === "K") {
      const modByte = Number.parseInt(parts[2] ?? "0", 16);
      const mods = MOD_BITS.filter((_, bit) => (modByte & (1 << bit)) !== 0);
      const keys = parts.slice(3).map((n) => keyloomName(n, unknown)).sort();
      const report: KeyboardReport = { at: Number(at), kind: "keyboard", mods, keys };
      if (sameList(report.mods, lastKeyboard.mods) && sameList(report.keys, lastKeyboard.keys)) continue;
      reports.push(report);
      lastKeyboard = report;
    } else if (kind === "C") {
      const name = parts[2];
      // A consumer report with usage 0 is the key coming up.
      const usages = name === undefined || name === "usage-0000" ? [] : [keyloomName(name, unknown)];
      if (sameList(usages, lastConsumer.usages)) continue;
      const report: ConsumerReport = { at: Number(at), kind: "consumer", usages };
      reports.push(report);
      lastConsumer = report;
    } else if (kind === "M") {
      mouse = true;
    }
  }

  const warnings: string[] = [];
  if (unknown.size > 0) warnings.push(`keys keyloom has no name for are shown by QMK's name: ${[...unknown].sort().join(", ")}`);
  if (mouse) warnings.push("mouse button and movement reports are not shown");
  return { reports, warnings };
}

// US-layout characters for typed keys: [unshifted, shifted].
const CHARS = new Map<string, readonly [string, string]>([
  ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => [c, [c.toLowerCase(), c]] as const),
  ...[..."1234567890"].map((c, i) => [`N${c}`, [c, ")!@#$%^&*("[i === 9 ? 0 : i + 1] as string]] as const),
  ["SPACE", [" ", " "]], ["ENTER", ["\n", "\n"]], ["TAB", ["\t", "\t"]],
  ["MINUS", ["-", "_"]], ["EQUAL", ["=", "+"]], ["LEFT_BRACKET", ["[", "{"]], ["RIGHT_BRACKET", ["]", "}"]], ["BACKSLASH", ["\\", "|"]],
  ["SEMICOLON", [";", ":"]], ["QUOTE", ["'", '"']], ["GRAVE", ["`", "~"]], ["COMMA", [",", "<"]], ["DOT", [".", ">"]], ["SLASH", ["/", "?"]],
]);

const SHORTCUT_MODS = new Set(["LCTL", "LALT", "LGUI", "RCTL", "RALT", "RGUI"]);

/**
 * What a text field would show, best effort: keys that newly go down type their US character,
 * Backspace deletes, and anything held with Ctrl, Alt or Gui is a shortcut and types nothing. Caps Lock
 * flips letter case, as the host does.
 */
export function typedText(reports: readonly EmulatorReport[]): string {
  let text = "";
  let caps = false;
  let down = new Set<string>();
  for (const r of reports) {
    if (r.kind !== "keyboard") continue;
    const fresh = r.keys.filter((k) => !down.has(k));
    down = new Set(r.keys);
    const shortcut = r.mods.some((m) => SHORTCUT_MODS.has(m));
    const shift = r.mods.includes("LSFT") || r.mods.includes("RSFT");
    for (const key of fresh) {
      if (key === "CAPS_LOCK") caps = !caps;
      else if (shortcut) continue;
      else if (key === "BACKSPACE") text = text.slice(0, -1);
      else {
        const pair = CHARS.get(key);
        if (!pair) continue;
        const letter = /^[A-Z]$/.test(key);
        text += pair[(letter ? shift !== caps : shift) ? 1 : 0];
      }
    }
  }
  return text;
}
