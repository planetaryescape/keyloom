// --format table|json|jsonl|ids (10#global-flags). JSON always carries schema_version so agents
// can depend on its shape.
import { UsageError } from "../app/index.ts";

export const FORMATS = ["table", "json", "jsonl", "ids"] as const;
export type Format = (typeof FORMATS)[number];

export const SCHEMA_VERSION = 1;

export type Io = { out: (text: string) => void; err: (text: string) => void; isTTY: boolean };

export const defaultFormat = (io: Io): Format => (io.isTTY ? "table" : "json");

/** One result, in every format. `rows` is what jsonl prints, one object per line. */
export type Output = {
  /** The JSON body, without schema_version. */
  json: Record<string, unknown>;
  table: string;
  /** IDs for `--format ids`; omit if the command has no IDs to pipe. */
  ids?: string[];
  rows?: Array<Record<string, unknown>>;
};

export function print(io: Io, format: Format, o: Output): void {
  switch (format) {
    case "table":
      io.out(o.table.endsWith("\n") ? o.table : `${o.table}\n`);
      return;
    case "json":
      io.out(`${JSON.stringify({ schema_version: SCHEMA_VERSION, ...o.json }, null, 2)}\n`);
      return;
    case "jsonl":
      for (const row of o.rows ?? [{ schema_version: SCHEMA_VERSION, ...o.json }]) io.out(`${JSON.stringify(row)}\n`);
      return;
    case "ids":
      if (!o.ids) throw new UsageError("--format ids isn't supported by this command");
      for (const id of o.ids) io.out(`${id}\n`);
  }
}

/** Left-aligned columns separated by two spaces. */
export function columns(rows: string[][]): string {
  const widths = rows[0]?.map((_, c) => Math.max(...rows.map((r) => [...(r[c] ?? "")].length))) ?? [];
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c] ?? 0))).join("  ")).join("\n");
}
