// `native` bindings on a kanata layout (D-024). A kanata one carries its own source; a QMK or ZMK one whose meaning kanata has a name
// for (read by layout/native-read.ts) is translated; the rest are refused by the generator rather than dropped.
import { type KeptMap, readNative } from "../native-read.ts";
import { MOD_ORDER, type Step } from "../native-meaning.ts";
import { modAction } from "./names.ts";
import { GenerateError } from "./generate-error.ts";

export const CAPS_WORD_MS = 2000;
export const ONE_SHOT_MS = 2000;

/**
 * Whether kanata source could run a command or reshape the config. kanata runs as root here (D-231), so keyloom never
 * writes `cmd` actions, never turns on `danger-enable-cmd`, and refuses any kept source that has one.
 */
export function dangerOf(source: string): string | undefined {
  const atoms = source.split(/[\s()]+/).filter((a) => a !== "");
  for (const a of atoms) {
    if (/^cmd([-_].*)?$/i.test(a) || /(^|-)cmd(-|$)/i.test(a) || /danger-enable-cmd/i.test(a)) return `\`${a}\` runs a command as root`;
    if (["include", "defsrc", "deflayer", "defcfg", "deflayermap", "defalias", "defvar", "defchordsv2", "defhands"].includes(a)) return `\`${a}\` would change the config's structure`;
  }
  if (source.includes(";") || source.includes("#|") || source.includes('"')) return "comments and strings aren't allowed in a kept binding";
  return undefined;
}

function balanced(source: string): boolean {
  let depth = 0;
  for (const c of source) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** The kanata action for a key's steps, or undefined when kanata has no action for them. A key with one step is the only shape kanata's one-shot and caps word take. */
export function kanataSource(steps: readonly Step[]): string | undefined {
  const [step] = steps;
  if (steps.length !== 1 || step === undefined) return undefined;
  if (step.kind === "oneShot") return `(one-shot ${ONE_SHOT_MS} ${modAction(step.mods)})`;
  if (step.kind === "capsWord") return `(caps-word-toggle ${CAPS_WORD_MS})`;
  return undefined;
}

/**
 * Whether a kanata native is one kanataSource writes: a one-shot of key names or a `(multi …)` of them, or the caps word. The
 * validator admits these for a put's copy (D-451); any other kanata source is still refused.
 */
export function kanataWrittenByKeyloom(source: string): boolean {
  if (source === `(caps-word-toggle ${CAPS_WORD_MS})`) return true;
  return KANATA_ONE_SHOT.test(source);
}

// Only the modifier key names modAction writes, so `(one-shot 2000 nonexistent-key)` is not one of keyloom's.
const KANATA_MOD = MOD_ORDER.map((m) => modAction([m])).join("|");
const KANATA_ONE_SHOT = new RegExp(`^\\(one-shot ${ONE_SHOT_MS} (?:(?:${KANATA_MOD})|\\(multi (?:${KANATA_MOD})(?: (?:${KANATA_MOD}))*\\))\\)$`);

/** What a native binding of any firmware becomes on kanata; throws when it can't be written. `kept` is the layout's kept ZMK behaviours. */
export function nativeAction(firmware: "qmk" | "zmk" | "kanata", source: string, where: string, kept: KeptMap = new Map()): string {
  const src = source.trim();
  if (firmware === "kanata") {
    const danger = dangerOf(src);
    if (danger) throw new GenerateError(`${where}: the kept kanata binding \`${src}\` is refused because ${danger}`);
    if (src === "" || !balanced(src)) throw new GenerateError(`${where}: the kept kanata binding \`${src}\` has unbalanced brackets`);
    return src;
  }
  const reading = readNative({ firmware, source: src }, kept);
  const action = reading.kind === "steps" ? kanataSource(reading.steps) : undefined;
  if (action !== undefined) return action;
  throw new GenerateError(`${where}: the ${firmware.toUpperCase()} binding \`${src}\` has no kanata equivalent keyloom knows, so it can't be written`);
}
