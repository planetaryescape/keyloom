// The firmware-wide options the settings page offers (D-103, D-191): what each one is called, its default, its range and
// when to change it. Every default below was read from the pinned firmware, not remembered: QMK's from ZSA's firmware25
// (quantum/action_tapping.h, process_combo.h, caps_word.h, process_auto_shift.h, action_util.c) and ZMK's from MoErgo's Kconfig
// as built into the Glove80 image. A "flag" with a default of false is simply not defined, which is how both firmwares read it.
import type { Firmware, FirmwareSetting, Layout } from "./schema.ts";

/** What the options need to know about a board. A structural type, because the layout layer sits below the board definitions. */
export type OptionBoard = { firmware: Firmware; settingDefaults?: Readonly<Record<string, number | boolean>> | undefined };

export type OptionGroup = "Typing feel" | "Keys" | "Power" | "Pairing";

type Base = {
  firmware: Firmware;
  /** The config.h / rules.mk / .conf name. */
  key: string;
  label: string;
  group: OptionGroup;
  /** When to change it, in plain words. */
  words: string;
  /** Another option that has to be on for this one to do anything. */
  needs?: string;
  /** QMK only: `rules` options are written to rules.mk as `KEY = yes`, not to config.h. */
  where?: "config" | "rules";
};
type NumberPart = { kind: "number"; unit: string; min: number; max: number; step: number; default: number; /** What 0 means, when it isn't "0 ms". */ zero?: string };
type FlagPart = { kind: "flag"; default: boolean };
export type OptionSpec = Base & (NumberPart | FlagPart);

type Written = Omit<Base, "firmware" | "where"> & (NumberPart | FlagPart);
const qmk = (o: Written & { where?: "config" | "rules" }): OptionSpec => ({ firmware: "qmk", where: "config", ...o });
const zmk = (o: Written): OptionSpec => ({ firmware: "zmk", ...o });

export const OPTIONS: readonly OptionSpec[] = [
  qmk({
    key: "TAPPING_TERM", label: "Tapping term", group: "Typing feel", kind: "number", unit: "ms", min: 100, max: 500, step: 10, default: 200,
    words: "How long you can hold a key before it counts as held, not tapped. Lower it if home-row modifiers feel slow to arrive; raise it if they fire while you type. A key with its own timing profile keeps that timing: tune those from the key.",
  }),
  qmk({
    key: "PERMISSIVE_HOLD", label: "Permissive hold", group: "Typing feel", kind: "flag", default: false,
    words: "Pressing and releasing another key while a tap-hold key is down counts as a hold, even before the tapping term ends. Turn it on if fast typists get letters where they wanted modifiers.",
  }),
  qmk({
    key: "HOLD_ON_OTHER_KEY_PRESS", label: "Hold on other key press", group: "Typing feel", kind: "flag", default: false,
    words: "Pressing any other key while a tap-hold key is down counts as a hold at once. It makes layer-taps instant and makes rolls between a tap-hold key and its neighbours misfire.",
  }),
  qmk({
    key: "CHORDAL_HOLD", label: "Chordal hold", group: "Typing feel", kind: "flag", default: false,
    words: "A tap-hold key only becomes a hold when the next key is on the opposite hand, so same-hand rolls stay taps. The usual cure for home-row modifiers firing during fast typing.",
  }),
  qmk({
    key: "RETRO_TAPPING", label: "Retro tapping", group: "Typing feel", kind: "flag", default: false,
    words: "Releasing a held tap-hold key with nothing else pressed sends its tap after all. It forgives a hold that ran long, at the cost of a lone hold sending a letter.",
  }),
  qmk({
    key: "COMBO_TERM", label: "Combo term", group: "Typing feel", kind: "number", unit: "ms", min: 10, max: 200, step: 5, default: 50,
    words: "How close together the keys of a combo must go down. Raise it if combos need a deliberate chord; lower it if they trigger while you type those letters in order. A combo with its own timing keeps it.",
  }),
  qmk({
    key: "ONESHOT_TIMEOUT", label: "One-shot timeout", group: "Typing feel", kind: "number", unit: "ms", min: 0, max: 5000, step: 100, default: 0, zero: "Never",
    words: "How long a one-shot modifier or layer waits for the next key before letting go. With no timeout it waits for as long as it takes; set one if a stray tap leaves Shift or a layer armed.",
  }),
  qmk({
    key: "CAPS_WORD_ENABLE", where: "rules", label: "Caps Word", group: "Keys", kind: "flag", default: false,
    words: "Capitalises the word you are typing and stops at the first space, so you can type SHOUTING_SNAKE_CASE without holding Shift or leaving Caps Lock on. Turning it on adds the feature to the firmware; put the Caps Word key (CW_TOGG, from Any) on a key to start it.",
  }),
  qmk({
    key: "CAPS_WORD_IDLE_TIMEOUT", label: "Caps Word timeout", group: "Keys", kind: "number", unit: "ms", min: 0, max: 20000, step: 500, default: 5000, zero: "Never", needs: "CAPS_WORD_ENABLE",
    words: "How long Caps Word waits with no typing before it switches itself off. Set it to Never if you would rather end it yourself.",
  }),
  qmk({
    key: "AUTO_SHIFT_ENABLE", where: "rules", label: "Auto Shift", group: "Keys", kind: "flag", default: false,
    words: "Holding a letter, number or symbol key types its shifted version, so you rarely reach for Shift. It makes every key a tap-hold key, so a slow tap types a capital by accident.",
  }),
  qmk({
    key: "AUTO_SHIFT_TIMEOUT", label: "Auto Shift timeout", group: "Keys", kind: "number", unit: "ms", min: 100, max: 300, step: 5, default: 175, needs: "AUTO_SHIFT_ENABLE",
    words: "How long a key is held before it types the shifted character. Lower it if capitals come out too slowly; raise it if slow taps come out capitalised.",
  }),
  qmk({
    key: "MOUSEKEY_ENABLE", where: "rules", label: "Mouse keys", group: "Keys", kind: "flag", default: false,
    words: "Lets keys move the pointer, click and scroll. Turn it off only if no key does that, to leave out the code for it.",
  }),
  zmk({
    key: "CONFIG_ZMK_POINTING", label: "Mouse keys", group: "Keys", kind: "flag", default: false,
    words: "Lets keys move the pointer, click and scroll. It has to be on before any mouse behaviour in the keymap does anything.",
  }),
  zmk({
    key: "CONFIG_ZMK_COMBO_MAX_PRESSED_COMBOS", label: "Combos held at once", group: "Typing feel", kind: "number", unit: "", min: 1, max: 16, step: 1, default: 4,
    words: "How many combos can be down together. The default is plenty unless you chain several combos in one go. A combo's own term is set on the combo.",
  }),
  zmk({
    key: "CONFIG_ZMK_MACRO_DEFAULT_WAIT_MS", label: "Macro wait", group: "Typing feel", kind: "number", unit: "ms", min: 0, max: 200, step: 5, default: 15,
    words: "The pause between the steps of a macro. Raise it if a program drops keys from a fast macro.",
  }),
  zmk({
    key: "CONFIG_ZMK_MACRO_DEFAULT_TAP_MS", label: "Macro tap length", group: "Typing feel", kind: "number", unit: "ms", min: 0, max: 200, step: 5, default: 30,
    words: "How long each key in a macro stays down. Raise it if a program misses taps from a macro.",
  }),
  zmk({
    key: "CONFIG_ZMK_IDLE_TIMEOUT", label: "Idle timeout", group: "Power", kind: "number", unit: "ms", min: 5000, max: 600000, step: 5000, default: 30000,
    words: "How long with no typing before the keyboard counts as idle and turns its lights off. Raise it if the lights go out while you read.",
  }),
  zmk({
    key: "CONFIG_ZMK_SLEEP", label: "Deep sleep", group: "Power", kind: "flag", default: false,
    words: "Lets the keyboard power down after a long idle. Saves battery on a wireless board, at the cost of a key press to wake it.",
  }),
  zmk({
    key: "CONFIG_ZMK_IDLE_SLEEP_TIMEOUT", label: "Deep sleep after", group: "Power", kind: "number", unit: "ms", min: 60000, max: 3600000, step: 60000, default: 900000, needs: "CONFIG_ZMK_SLEEP",
    words: "How long with no typing before deep sleep starts.",
  }),
  zmk({
    key: "CONFIG_ZMK_BLE_PASSKEY_ENTRY", label: "Pairing passkey", group: "Pairing", kind: "flag", default: false,
    words: "Makes the computer ask for a number to type on the keyboard when pairing, so nobody nearby can pair with it. Off is quicker.",
  }),
];

/** The options the settings page shows for a board: its firmware's only, so a QMK board never sees a ZMK option. */
export const optionsFor = (board: Pick<OptionBoard, "firmware">): OptionSpec[] => OPTIONS.filter((o) => o.firmware === board.firmware);

/** QMK options that go in rules.mk. The generator writes these there and never to config.h. */
export const RULES_KEYS: ReadonlySet<string> = new Set(OPTIONS.filter((o) => o.firmware === "qmk" && o.where === "rules").map((o) => o.key));

/** The firmware's own default on this board. */
export function defaultOf(spec: OptionSpec, board: Pick<OptionBoard, "settingDefaults">): number | boolean {
  return board.settingDefaults?.[spec.key] ?? spec.default;
}

const ASSIGNMENT = (key: string) => new RegExp(`^\\s*${key}\\s*[:?]?=\\s*(\\S+)`, "gm");

/** The last `KEY = yes|no` in the layout's rules.mk, which is the one make uses. */
function rulesValue(layout: Layout, key: string): boolean | undefined {
  const text = layout.passthrough.find((p) => p.firmware === "qmk" && p.file === "rules.mk")?.source ?? "";
  const last = [...text.matchAll(ASSIGNMENT(key))].at(-1)?.[1];
  return last === undefined ? undefined : last.toLowerCase() === "yes";
}

/** What the firmware will do now: the setting if there is one, else the baseline. */
export function currentValue(spec: OptionSpec, layout: Layout, board: Pick<OptionBoard, "settingDefaults">): number | boolean {
  const own = layout.settings.find((s) => s.firmware === spec.firmware && s.key === spec.key)?.value;
  if (spec.kind === "flag") return own === undefined ? Boolean(baselineOf(spec, layout, board)) : own === true || (typeof own === "number" && own !== 0);
  return typeof own === "number" ? own : Number(baselineOf(spec, layout, board));
}

/**
 * The source text of a setting the page can't turn into a number or a switch (`(TAPPING_TERM + 10)`, `5000UL`), or undefined.
 * The page shows it as it is and leaves it alone, because reading it as the default would be a lie about what the keyboard does.
 */
export function sourceText(spec: OptionSpec, layout: Layout): string | undefined {
  const own = layout.settings.find((s) => s.firmware === spec.firmware && s.key === spec.key)?.value;
  return typeof own === "string" ? own : undefined;
}

/** True when the layout writes this option, so it differs from "whatever the firmware does". */
export const isSet = (spec: OptionSpec, layout: Layout): boolean => layout.settings.some((s) => s.firmware === spec.firmware && s.key === spec.key);

/** Settings the page doesn't have a control for, listed read-only so nothing is hidden. */
export function otherSettings(layout: Layout, board: Pick<OptionBoard, "firmware">): FirmwareSetting[] {
  const known = new Set(optionsFor(board).map((o) => o.key));
  return layout.settings.filter((s) => s.firmware === board.firmware && !known.has(s.key));
}

/** What the firmware does with no setting from keyloom: rules.mk as Oryx wrote it for a feature switch, else the default. */
export function baselineOf(spec: OptionSpec, layout: Layout, board: Pick<OptionBoard, "settingDefaults">): number | boolean {
  if (spec.kind === "flag" && spec.firmware === "qmk" && spec.where === "rules") return rulesValue(layout, spec.key) ?? Boolean(defaultOf(spec, board));
  return defaultOf(spec, board);
}
