// Generates src/layout/keycodes.ts (D-044): keyloom's closed KeyCode set, joined from ZMK's
// HID table and QMK's keycode data on the HID usage both firmwares send.
//
//   bun scripts/gen-keycodes.ts           write src/layout/keycodes.ts
//   bun scripts/gen-keycodes.ts --check   fail if the committed file differs (CI drift check)
//
// Sources are fetched at pinned SHAs. The generated file is committed.
import Hjson from "hjson";
import { join } from "node:path";

const ZMK_REPO = "zmkfirmware/zmk";
const ZMK_SHA = "4dd95d7840eb3d5a3f59bb29fbf1ab054715ef85";
const QMK_REPO = "qmk/qmk_firmware";
const QMK_SHA = "7a1bbf37c5c07da4ea0a162bb139083a46ef40a1";

const raw = (repo: string, sha: string, path: string) => `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;

// The file list at QMK_SHA (data/constants/keycodes/). Pinned, so it's listed rather than discovered:
// the tree API is rate limited without a token. extras/keycodes_us is the only layout file used (shifted aliases).
const QMK_FILES = [
  "keycodes_0.0.1.hjson", "keycodes_0.0.1_audio.hjson", "keycodes_0.0.1_basic.hjson", "keycodes_0.0.1_joystick.hjson",
  "keycodes_0.0.1_lighting.hjson", "keycodes_0.0.1_macro.hjson", "keycodes_0.0.1_magic.hjson", "keycodes_0.0.1_midi.hjson",
  "keycodes_0.0.1_programmable_button.hjson", "keycodes_0.0.1_quantum.hjson", "keycodes_0.0.1_sequencer.hjson",
  "keycodes_0.0.1_steno.hjson", "keycodes_0.0.1_swap_hands.hjson", "keycodes_0.0.2.hjson", "keycodes_0.0.2_basic.hjson",
  "keycodes_0.0.2_kb.hjson", "keycodes_0.0.2_magic.hjson", "keycodes_0.0.2_midi.hjson", "keycodes_0.0.2_quantum.hjson",
  "keycodes_0.0.2_sequencer.hjson", "keycodes_0.0.2_swap_hands.hjson", "keycodes_0.0.2_user.hjson", "keycodes_0.0.3.hjson",
  "keycodes_0.0.3_quantum.hjson", "keycodes_0.0.4.hjson", "keycodes_0.0.4_lighting.hjson", "keycodes_0.0.5.hjson",
  "keycodes_0.0.5_basic.hjson", "keycodes_0.0.6.hjson", "keycodes_0.0.6_connection.hjson", "keycodes_0.0.6_quantum.hjson",
  "keycodes_0.0.7.hjson", "keycodes_0.0.8.hjson", "keycodes_0.0.8_lighting.hjson", "keycodes_0.0.9.hjson",
  "keycodes_0.0.9_steno.hjson",
] as const;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

// HID usage = (page << 16) | id.
const KEYBOARD_PAGE = 0x07;
const usageOf = (page: number, id: number) => (page << 16) | id;
const LSHIFT_USAGE = usageOf(KEYBOARD_PAGE, 0xe1);

// --- ZMK ---------------------------------------------------------------------------------------

type ZmkEntry = { names: string[]; context: string; description: string; usages: number[] };

function parseZmk(source: string): ZmkEntry[] {
  // hid.js is an ES module that imports helper constants. They are three trivial values, so
  // they are supplied here instead of fetching and bundling five more files.
  const body = source.replace(/^import[\s\S]*?;\n/gm, "").replace("export default", "return");
  // oxlint-disable-next-line no-new-func -- pinned, reviewed upstream data file; no network or fs access is given to it.
  const build = new Function("keyboardApplication", "consumerApplication", "keyPage", "consumerPage", "usage", body) as (
    ...args: unknown[]
  ) => Array<{ names: string[]; context: string; description: string; usages: Array<{ item: number }> }>;
  const entries = build("keyboard", "consumer", KEYBOARD_PAGE, 0x0c, usageOf);
  return entries.map((e) => ({
    names: e.names.filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n)),
    context: e.context,
    description: e.description,
    usages: e.usages.map((u) => u.item),
  }));
}

// --- QMK ---------------------------------------------------------------------------------------

type QmkEntry = { code: number; key: string; aliases: string[]; label: string; group: string };

function parseQmk(files: Map<string, string>): { entries: QmkEntry[]; shifted: Array<{ base: string; names: string[]; label: string }> } {
  const entries: QmkEntry[] = [];
  const shifted: Array<{ base: string; names: string[]; label: string }> = [];
  for (const [file, text] of files) {
    const doc = Hjson.parse(text) as {
      keycodes?: Record<string, { group?: string; key: string; label?: string; aliases?: string[] }>;
      aliases?: Record<string, { key: string; label?: string; aliases?: string[] }>;
    };
    for (const [hex, v] of Object.entries(doc.keycodes ?? {})) {
      entries.push({
        code: Number.parseInt(hex, 16),
        key: v.key,
        aliases: (v.aliases ?? []).filter((a) => /^[A-Z][A-Z0-9_]*$/.test(a)),
        label: v.label ?? v.key,
        group: v.group ?? "",
      });
    }
    // Only the US layout carries the shifted symbols as `S(KC_x)` aliases.
    if (file === "extras/keycodes_us_0.0.1.hjson") {
      for (const [expr, v] of Object.entries(doc.aliases ?? {})) {
        const m = /^S\((KC_[A-Z0-9_]+)\)$/.exec(expr);
        if (m?.[1]) shifted.push({ base: m[1], names: [v.key, ...(v.aliases ?? [])], label: v.label ?? v.key });
      }
    }
  }
  return { entries, shifted };
}

/** QMK's own keycode -> consumer/system usage tables, parsed from tmk_core/protocol/report.h. */
function parseQmkReportUsages(source: string): Map<string, number> {
  const enumValue = new Map<string, number>();
  for (const m of source.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(0x[0-9A-Fa-f]+)\s*,?/gm)) {
    if (m[1] && m[2]) enumValue.set(m[1], Number.parseInt(m[2], 16));
  }
  const out = new Map<string, number>();
  for (const [fn, page] of [["KEYCODE2CONSUMER", 0x0c], ["KEYCODE2SYSTEM", 0x01]] as const) {
    const start = source.indexOf(`static inline uint16_t ${fn}(`);
    if (start < 0) throw new Error(`${fn} not found in report.h`);
    const block = source.slice(start, source.indexOf("\n}\n", start));
    for (const m of block.matchAll(/case (KC_[A-Z0-9_]+):\s*return ([A-Z][A-Z0-9_]*);/g)) {
      const id = m[2] ? enumValue.get(m[2]) : undefined;
      if (m[1] && id !== undefined) out.set(m[1], usageOf(page, id));
    }
  }
  return out;
}

// --- Join --------------------------------------------------------------------------------------

type Category =
  | "letter" | "number" | "punctuation" | "control" | "navigation" | "function" | "modifier" | "keypad"
  | "international" | "media" | "system" | "other";

function categoryOf(usage: number, zmkContext: string): Category {
  const page = usage >> 16;
  const id = usage & 0xffff;
  if (page === 0x0c) return "media";
  if (page === 0x01) return "system";
  if (page !== KEYBOARD_PAGE) return "other";
  if (id >= 0xe0 && id <= 0xe7) return "modifier";
  if (id >= 0x04 && id <= 0x1d) return "letter";
  if (id >= 0x1e && id <= 0x27) return "number";
  if ((id >= 0x28 && id <= 0x2c) || id === 0x39 || (id >= 0x46 && id <= 0x48) || id === 0x65 || id === 0x76) return "control";
  if (id >= 0x2d && id <= 0x38) return "punctuation";
  if ((id >= 0x3a && id <= 0x45) || (id >= 0x68 && id <= 0x73)) return "function";
  if (id >= 0x49 && id <= 0x52) return "navigation";
  if (zmkContext === "Keypad") return "keypad";
  if (id === 0x64) return "punctuation";
  if (id >= 0x87 && id <= 0x98) return "international";
  if (id >= 0x80 && id <= 0x82) return "media";
  return "other";
}

type Joined = {
  name: string;
  qmk: string[]; // QMK canonical first, then aliases
  zmk: string[]; // ZMK names, canonical first
  label: string;
  category: Category;
  qmkBasic: boolean;
  usage: number;
};

type Shifted = { code: string; qmk: string[]; zmk: string[]; label: string };

function keyloomName(qmkKey: string): string {
  const base = qmkKey.replace(/^KC_/, "");
  // Identifiers can't start with a digit, and ZMK/QMK both call these N1..N0 / 1..0 differently.
  return /^[0-9]$/.test(base) ? `N${base}` : base;
}

async function build(): Promise<string> {
  const [hid, report, ...qmkTexts] = await Promise.all([
    fetchText(raw(ZMK_REPO, ZMK_SHA, "docs/src/data/hid.js")),
    fetchText(raw(QMK_REPO, QMK_SHA, "tmk_core/protocol/report.h")),
    ...QMK_FILES.map((f) => fetchText(raw(QMK_REPO, QMK_SHA, `data/constants/keycodes/${f}`))),
    fetchText(raw(QMK_REPO, QMK_SHA, "data/constants/keycodes/extras/keycodes_us_0.0.1.hjson")),
  ]);
  const files = new Map<string, string>();
  [...QMK_FILES, "extras/keycodes_us_0.0.1.hjson"].forEach((f, i) => files.set(f, qmkTexts[i] as string));

  const zmk = parseZmk(hid);
  const qmk = parseQmk(files);
  const reportUsages = parseQmkReportUsages(report);

  // QMK keycode -> usage. Keyboard-page codes are the HID usage id itself; the media block
  // (0xA5-0xDF) maps through QMK's own consumer/system tables.
  const qmkByUsage = new Map<number, QmkEntry>();
  for (const e of qmk.entries) {
    if (e.group === "internal" || e.code > 0xff) continue;
    let usage: number | undefined;
    if ((e.code >= 0x04 && e.code <= 0xa4) || (e.code >= 0xe0 && e.code <= 0xe7)) usage = usageOf(KEYBOARD_PAGE, e.code);
    else usage = reportUsages.get(e.key);
    if (usage === undefined) continue;
    if (qmkByUsage.has(usage)) throw new Error(`two QMK keycodes share usage ${usage.toString(16)}: ${qmkByUsage.get(usage)?.key}, ${e.key}`);
    qmkByUsage.set(usage, e);
  }

  const joined: Joined[] = [];
  const zmkSingle = new Map<number, ZmkEntry>();
  const zmkShifted: Array<{ base: number; entry: ZmkEntry }> = [];
  for (const z of zmk) {
    if (z.usages.length === 1) {
      const u = z.usages[0] as number;
      if (zmkSingle.has(u)) throw new Error(`two ZMK entries share usage ${u.toString(16)}`);
      zmkSingle.set(u, z);
    } else if (z.usages.length === 2 && z.usages[1] === LSHIFT_USAGE) {
      zmkShifted.push({ base: z.usages[0] as number, entry: z });
    }
  }

  for (const [usage, q] of qmkByUsage) {
    const z = zmkSingle.get(usage);
    if (!z || z.names.length === 0) continue;
    joined.push({
      name: keyloomName(q.key),
      qmk: [q.key, ...q.aliases.filter((a) => a !== q.key)],
      zmk: z.names,
      label: q.label,
      category: categoryOf(usage, z.context),
      qmkBasic: q.code <= 0xff,
      usage,
    });
  }
  joined.sort((a, b) => a.usage - b.usage);

  const names = new Set<string>();
  for (const j of joined) {
    if (names.has(j.name)) throw new Error(`duplicate keyloom name ${j.name}`);
    names.add(j.name);
  }

  // Shifted symbols: QMK's `S(KC_x)` aliases joined to ZMK's two-usage entries on (base usage, LSFT).
  const byQmkKey = new Map(joined.map((j) => [j.qmk[0] as string, j]));
  const shifted: Shifted[] = [];
  for (const s of qmk.shifted) {
    const base = byQmkKey.get(s.base);
    if (!base) continue;
    const z = zmkShifted.find((x) => x.base === base.usage);
    shifted.push({ code: base.name, qmk: s.names, zmk: z?.entry.names ?? [], label: s.label });
  }

  return render(joined, shifted);
}

const q = (s: string) => JSON.stringify(s);
const list = (xs: readonly string[]) => `[${xs.map(q).join(", ")}]`;

function render(joined: Joined[], shifted: Shifted[]): string {
  const rows = joined.map(
    (j) => `  [${q(j.name)}, ${list(j.qmk)}, ${list(j.zmk)}, ${q(j.label)}, ${q(j.category)}, ${j.qmkBasic}],`,
  );
  const shiftedRows = shifted.map((s) => `  [${q(s.code)}, ${list(s.qmk)}, ${list(s.zmk)}, ${q(s.label)}],`);
  return `// GENERATED by scripts/gen-keycodes.ts. Do not edit; run \`bun scripts/gen-keycodes.ts\`.
//
// keyloom's closed KeyCode set (D-044): the keys both firmwares send, joined on HID usage.
// Names on only one firmware are not here; they are reachable only as \`native\` bindings.
//
// Sources (pinned):
//   ZMK  ${ZMK_REPO}@${ZMK_SHA}  docs/src/data/hid.js
//   QMK  ${QMK_REPO}@${QMK_SHA}  data/constants/keycodes/keycodes_*.hjson, extras/keycodes_us_0.0.1.hjson,
//        tmk_core/protocol/report.h (consumer/system usages for the media block)
//
// Naming: the keyloom name is QMK's canonical key without the KC_ prefix (ENTER, SPACE, LEFT_BRACKET),
// with digits written N0..N9. Every other QMK alias and every ZMK name resolves to it.

export type KeyCodeCategory =
  | "letter" | "number" | "punctuation" | "control" | "navigation" | "function" | "modifier" | "keypad"
  | "international" | "media" | "system" | "other";

export type KeyCodeInfo = {
  name: KeyCode;
  /** QMK canonical name first, then aliases (KC_ESCAPE, KC_ESC). */
  qmk: readonly string[];
  /** ZMK names, canonical first. */
  zmk: readonly string[];
  label: string;
  category: KeyCodeCategory;
  /** True when QMK's keycode fits in 8 bits, the only kind a mod-tap's tap side accepts. */
  qmkBasic: boolean;
};

// [name, qmk, zmk, label, category, qmkBasic]
const ROWS = [
${rows.join("\n")}
] as const;

// [base keycode name, qmk names, zmk names, label]. Each is the base key sent with Left Shift.
const SHIFTED_ROWS = [
${shiftedRows.join("\n")}
] as const;

export type KeyCode = (typeof ROWS)[number][0];

export const KEYCODES: readonly KeyCodeInfo[] = ROWS.map(([name, qmk, zmk, label, category, qmkBasic]) => ({
  name,
  qmk,
  zmk,
  label,
  category,
  qmkBasic,
}));

// Maps, not objects: a layer or macro named "constructor" must never hit Object.prototype.
const byName = new Map<string, KeyCodeInfo>(KEYCODES.map((k) => [k.name, k]));
const byQmk = new Map<string, KeyCodeInfo>(KEYCODES.flatMap((k) => k.qmk.map((n) => [n, k] as const)));
const byZmk = new Map<string, KeyCodeInfo>(KEYCODES.flatMap((k) => k.zmk.map((n) => [n, k] as const)));

export type ShiftedKey = { code: KeyCode; mods: readonly ["LSFT"]; label: string };
const shiftedByQmk = new Map<string, ShiftedKey>();
const shiftedByZmk = new Map<string, ShiftedKey>();
for (const [code, qmk, zmk, label] of SHIFTED_ROWS) {
  const value: ShiftedKey = { code, mods: ["LSFT"], label };
  for (const n of qmk) shiftedByQmk.set(n, value);
  for (const n of zmk) shiftedByZmk.set(n, value);
}

/** True for a canonical keyloom name. Aliases are not accepted; resolve them first. */
export function isKeyCode(name: unknown): name is KeyCode {
  return typeof name === "string" && byName.has(name);
}

export function keyCodeInfo(name: KeyCode): KeyCodeInfo {
  return byName.get(name) as KeyCodeInfo;
}

/** The label to draw for a key, falling back to the name for anything outside the table. */
export function keyCodeLabel(name: string): string {
  return byName.get(name)?.label ?? name;
}

/** A QMK \`KC_*\` name or alias to its keyloom key. */
export function fromQmk(name: string): KeyCodeInfo | undefined {
  return byQmk.get(name);
}

/** A ZMK key name or alias to its keyloom key. */
export function fromZmk(name: string): KeyCodeInfo | undefined {
  return byZmk.get(name);
}

/** QMK shifted symbols (KC_EXLM, KC_LCBR, KC_TILD...) to base key plus Left Shift. */
export function fromQmkShifted(name: string): ShiftedKey | undefined {
  return shiftedByQmk.get(name);
}

/** ZMK shifted symbols (EXCLAMATION, LBRC...) to base key plus Left Shift. */
export function fromZmkShifted(name: string): ShiftedKey | undefined {
  return shiftedByZmk.get(name);
}

export function qmkName(code: KeyCode): string {
  return keyCodeInfo(code).qmk[0] as string;
}

export function zmkName(code: KeyCode): string {
  return keyCodeInfo(code).zmk[0] as string;
}
`;
}

const OUT = join(import.meta.dir, "..", "src", "layout", "keycodes.ts");
const generated = await build();
if (process.argv.includes("--check")) {
  const committed = await Bun.file(OUT).text();
  if (committed !== generated) {
    console.error("src/layout/keycodes.ts is out of date. Run: bun scripts/gen-keycodes.ts");
    process.exit(1);
  }
  console.log("keycodes.ts is up to date");
} else {
  await Bun.write(OUT, generated);
  console.log(`wrote ${OUT}`);
}
