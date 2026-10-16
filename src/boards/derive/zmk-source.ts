// What keyloom reads out of ZMK's tree to know a keyboard: its product string, USB ids and physical layout. Kconfig and devicetree are
// regular enough here that patterns are clearer than parsers, the same call src/boards/zmk-geometry.ts makes for the key list.
// Pure; callers supply the files' text.
import { withoutComments } from "../zmk-geometry.ts";

export type KeyboardName = {
  /** The `SHIELD_*` names the setting applies under, lower case (`corne_left`); empty when it is unconditional. */
  shields: string[];
  name: string;
};

/**
 * `config ZMK_KEYBOARD_NAME` defaults in a shield's Kconfig.defconfig. A split shield sets it for its central half only
 * (`if SHIELD_CORNE_LEFT`), and the right half gets whatever an unset string gives, so the condition says which half carries the name.
 */
export function keyboardNames(kconfig: string): KeyboardName[] {
  const out: KeyboardName[] = [];
  const conditions: string[] = [];
  const lines = kconfig.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    const open = /^if\s+(.+?)\s*(#.*)?$/.exec(line);
    if (open) conditions.push(open[1] as string);
    else if (/^endif\b/.test(line)) conditions.pop();
    else if (/^config\s+ZMK_KEYBOARD_NAME\b/.test(line)) {
      for (let j = i + 1; j < lines.length && !/^\s*(config|endif|if|choice|endchoice|menu)\b/.test(lines[j] as string); j++) {
        const m = /^\s*default\s+"([^"]*)"/.exec(lines[j] as string);
        if (m) {
          const shields = conditions.flatMap((c) => [...c.matchAll(/\bSHIELD_([A-Z0-9_]+)/g)].map((x) => (x[1] as string).toLowerCase()));
          out.push({ shields: [...new Set(shields)], name: m[1] as string });
          break;
        }
      }
    }
  }
  return out;
}

/** `CONFIG_ZMK_KEYBOARD_NAME="Glove80 Left"` and the USB ids in a board's defconfig. */
export function defconfigIdentity(defconfig: string): { name?: string; vid?: string; pid?: string } {
  const get = (key: string) => new RegExp(`^CONFIG_${key}=(.+?)\\s*$`, "m").exec(defconfig)?.[1];
  const name = get("ZMK_KEYBOARD_NAME")?.replace(/^"|"$/g, "");
  const id = (v: string | undefined) => (v !== undefined && /^0x[0-9a-f]+$/i.test(v) ? `0x${Number.parseInt(v, 16).toString(16).padStart(4, "0")}` : undefined);
  const vid = id(get("USB_DEVICE_VID"));
  const pid = id(get("USB_DEVICE_PID"));
  return { ...(name === undefined ? {} : { name }), ...(vid === undefined ? {} : { vid }), ...(pid === undefined ? {} : { pid }) };
}

/** The label a shield's `chosen` block gives its physical layout: `zmk,physical-layout = &foostan_corne_6col_layout;`. */
export function physicalLayoutLabel(dts: string): string | undefined {
  return /zmk,physical-layout\s*=\s*&([A-Za-z0-9_]+)\s*;/.exec(withoutComments(dts))?.[1];
}
