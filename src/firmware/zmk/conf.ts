// glove80.conf: Kconfig fragment lines <-> FirmwareSetting (06). A line that isn't `CONFIG_X=value`
// is returned as it is, so the importer can keep it instead of dropping it.
import type { FirmwareSetting } from "../../layout/schema.ts";

export function parseConf(text: string): { settings: FirmwareSetting[]; other: Array<{ line: number; text: string }> } {
  const settings: FirmwareSetting[] = [];
  const other: Array<{ line: number; text: string }> = [];
  text.replace(/\r\n?/g, "\n").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const m = /^(CONFIG_[A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      other.push({ line: i + 1, text: line });
      return;
    }
    const [, key, value] = m as unknown as [string, string, string];
    // Strings keep their quotes and other text stays as written, the way the QMK importer keeps C source text (02).
    settings.push({ firmware: "zmk", key, value: value === "y" ? true : value === "n" ? false : /^-?\d+$/.test(value) ? Number(value) : value });
  });
  return { settings, other };
}

export function settingLine(s: FirmwareSetting): string {
  return `${s.key}=${s.value === true ? "y" : s.value === false ? "n" : s.value}`;
}
