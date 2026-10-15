// Maps a compiler message that names a line of glove80.keymap back to the layer and position the
// person edits (06). cpp prints `glove80.keymap:LINE:COL` and dtc `glove80.keymap:LINE.COL-COL`, and
// the generated file is what they read, so the line is a line of the text keyloom wrote. Zephyr's
// devicetree script prints `glove80.keymap:LINE (column N)` instead, and its column counts the text after
// cpp has expanded every key name (seen 2026-10-15: column 245 on a 100-character line), so that column
// is left out and the whole row is named.
import { callText, parseCalls } from "./cells.ts";

export type Located = { line: number; column: number | undefined; message: string };

// The keymap is named for the board (`glove80`, `corne`), so any `<name>.keymap` is the generated file.
const AT = /[\w-]+\.keymap:(\d+)(?:[.:](\d+)|\s*\(column \d+\))?/;

/** The first error that names the keymap, with its message. */
export function locateCompileError(output: readonly string[]): Located | undefined {
  for (const l of output) {
    const m = AT.exec(l);
    if (m && /error|ERROR|syntax/i.test(l)) {
      return { line: Number(m[1]), column: m[2] === undefined ? undefined : Number(m[2]), message: l.slice(l.indexOf(m[0]) + m[0].length).replace(/^[-\d.:]*\s*/, "").replace(/^error:\s*/i, "").trim() };
    }
  }
  return undefined;
}

/** `layer "Base" (layer 0), position 12 (&kp NOPE)` for a line inside a layer's bindings, else the line itself. */
export function describeLocation(keymap: string, at: Located, fileName = "glove80.keymap"): string {
  const lines = keymap.split("\n");
  const text = lines[at.line - 1] ?? "";
  let layerLine = -1;
  for (let i = at.line - 1; i >= 0; i--) {
    if (/^\s*\/\/ layer \d+$/.test(lines[i] as string)) {
      layerLine = i;
      break;
    }
  }
  const generic = `line ${at.line} of ${fileName} (${text.trim() || "blank"})`;
  if (layerLine < 0) return generic;
  const start = lines.findIndex((l, i) => i > layerLine && /^\s*bindings = <$/.test(l));
  if (start < 0 || at.line - 1 <= start) return generic;
  const end = lines.findIndex((l, i) => i > start && /^\s*>;$/.test(l));
  if (end >= 0 && at.line - 1 >= end) return generic;

  const before = parseCalls(lines.slice(start + 1, at.line - 1).join("\n")).calls.length;
  const inLine = parseCalls(text).calls.length;
  const calls = parseCalls(lines.slice(start + 1, end < 0 ? undefined : end).join("\n")).calls;
  const name = /display-name = "(.*)";/.exec(lines.slice(layerLine, start).join("\n"))?.[1];
  const index = /layer (\d+)/.exec(lines[layerLine] as string)?.[1];
  const layer = `layer ${name ? `"${name}" ` : ""}(layer ${index})`;
  if (at.column === undefined) return inLine <= 1 ? `${layer}, position ${before}` : `${layer}, one of positions ${before} to ${before + inLine - 1}`;
  const upToColumn = (text.slice(0, at.column).match(/&/g) ?? []).length;
  const position = before + Math.max(0, upToColumn - 1);
  const call = calls[position];
  return `${layer}, position ${position}${call ? ` (${callText(call)})` : ""}`;
}

/**
 * Kconfig prints a rejected setting as `glove80.conf:LINE: warning: '"x"' is not a valid value for the bool symbol X`
 * and then aborts the build on warnings, so the useful line comes well before the last one.
 */
export function locateConfError(output: readonly string[], conf: string): string | undefined {
  for (const l of output) {
    const m = /([\w-]+\.conf):(\d+):\s*(?:warning:|error:)?\s*(.*)$/.exec(l);
    if (m) return `${m[1]} has a setting ZMK rejected: ${(m[3] as string).replace(/\s*\(defined at .*$/, "")} (line ${m[2]}: ${(conf.split("\n")[Number(m[2]) - 1] ?? "").trim()})`;
  }
  return undefined;
}
