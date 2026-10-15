// `native` bindings on a kanata layout (D-024). A kanata one carries its own source; QMK and ZMK ones that mean something
// kanata has a name for are translated; the rest are refused by the generator rather than dropped.
import type { Mod } from "../schema.ts";
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

const QMK_MODS: Record<string, Mod> = { MOD_LSFT: "LSFT", MOD_LCTL: "LCTL", MOD_LALT: "LALT", MOD_LGUI: "LGUI", MOD_RSFT: "RSFT", MOD_RCTL: "RCTL", MOD_RALT: "RALT", MOD_RGUI: "RGUI" };
const ZMK_MODS: Record<string, Mod> = { LSHFT: "LSFT", LSHIFT: "LSFT", LCTRL: "LCTL", LCTL: "LCTL", LALT: "LALT", LGUI: "LGUI", LCMD: "LGUI", RSHFT: "RSFT", RSHIFT: "RSFT", RCTRL: "RCTL", RCTL: "RCTL", RALT: "RALT", RGUI: "RGUI", RCMD: "RGUI" };

/** What a native binding of any firmware becomes on kanata; throws when it can't be written. */
export function nativeAction(firmware: "qmk" | "zmk" | "kanata", source: string, where: string): string {
  const src = source.trim();
  if (firmware === "kanata") {
    const danger = dangerOf(src);
    if (danger) throw new GenerateError(`${where}: the kept kanata binding \`${src}\` is refused because ${danger}`);
    if (src === "" || !balanced(src)) throw new GenerateError(`${where}: the kept kanata binding \`${src}\` has unbalanced brackets`);
    return src;
  }
  if (firmware === "qmk") {
    if (src === "CW_TOGG" || src === "QK_CAPS_WORD_TOGGLE") return `(caps-word-toggle ${CAPS_WORD_MS})`;
    const osm = /^OSM\(\s*(MOD_\w+)\s*\)$/.exec(src);
    const mod = osm?.[1] ? QMK_MODS[osm[1]] : undefined;
    if (mod) return `(one-shot ${ONE_SHOT_MS} ${modAction([mod])})`;
  } else {
    if (/^&caps_word$/.test(src)) return `(caps-word-toggle ${CAPS_WORD_MS})`;
    const sk = /^&sk\s+(\w+)$/.exec(src);
    const mod = sk?.[1] ? ZMK_MODS[sk[1]] : undefined;
    if (mod) return `(one-shot ${ONE_SHOT_MS} ${modAction([mod])})`;
  }
  throw new GenerateError(`${where}: the ${firmware.toUpperCase()} binding \`${src}\` has no kanata equivalent keyloom knows, so it can't be written`);
}
