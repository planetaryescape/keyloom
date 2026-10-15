// emulate (10#emulate-prints-what-a-layout-types-for-a-sequence-of-key-presses): what a layout would type for a sequence of key presses. Thin: one use case in src/app.
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { type App, SCRIPT_HELP, UsageError, emulateLayout } from "../../app/index.ts";
import { type Format, type Io, print } from "../output.ts";
import { progressLine, untilInterrupted } from "./firmware.ts";

export type EmulateCommandDeps = {
  io: Io;
  format: () => Format;
  quiet: () => boolean;
  withApp: <T>(fn: (app: App) => Promise<T> | T) => Promise<T>;
};

type Report = Awaited<ReturnType<typeof emulateLayout>>["reports"][number];

/** `LSFT + U` for a keyboard report, `media: AUDIO_VOL_UP` for a consumer one, `(nothing down)` for an empty one. */
export function describeReport(r: Report): string {
  if (r.kind === "consumer") return r.usages.length === 0 ? "(nothing down)" : `media: ${r.usages.join(" + ")}`;
  const parts = [...r.mods, ...r.keys];
  return parts.length === 0 ? "(nothing down)" : parts.join(" + ");
}

export function registerEmulateCommand(program: Command, deps: EmulateCommandDeps): void {
  const { io, format, quiet, withApp } = deps;

  program
    .command("emulate")
    .description("run the real firmware logic on this machine and print what the keyboard would send for a sequence of key presses")
    .argument("<layout>", "layout ID or name")
    .option("--keys <script>", 'the key presses, such as "hold 31 300 then tap 32"')
    .option("--script <file>", "a file with the key presses, one step per line")
    .option("--rev <revision>", "a revision ID instead of the head")
    .option("--board-rev <revision>", "board revision, such as reva or revb (QMK boards with several)")
    .addHelpText("after", `\nKey script:\n${SCRIPT_HELP}\n`)
    .action(async (ref: string, opts: { keys?: string; script?: string; rev?: string; boardRev?: string }) => {
      if ((opts.keys === undefined) === (opts.script === undefined)) throw new UsageError("pass the key presses with --keys <script> or --script <file>, not both");
      let script = opts.keys as string;
      if (opts.script !== undefined) {
        try {
          script = await readFile(opts.script, "utf8");
        } catch {
          throw new UsageError(`can't read the script file ${opts.script}`);
        }
      }
      const progress = progressLine(io);
      try {
        const r = await untilInterrupted((signal) =>
          withApp((app) =>
            emulateLayout(app, ref, {
              script,
              ...(opts.rev ? { revisionId: opts.rev } : {}),
              ...(opts.boardRev ? { boardRevision: opts.boardRev } : {}),
              onProgress: progress.write,
              signal,
            }),
          ),
        );
        progress.end();
        const lines = r.reports.map((rep) => `${String(rep.at).padStart(6)} ms  ${describeReport(rep)}`);
        print(io, format(), {
          json: { layout_id: r.layoutId, revision_id: r.revisionId, firmware: r.firmware, reports: r.reports, text: r.text, warnings: r.warnings, log_path: r.logPath },
          table: quiet()
            ? r.text
            : [
                ...(lines.length === 0 ? ["no reports: the keys sent nothing"] : lines),
                `text: ${JSON.stringify(r.text)}`,
                ...(r.warnings.length === 0 ? [] : ["warnings:", ...r.warnings.map((w) => `  ${w}`)]),
              ].join("\n"),
          rows: r.reports.map((rep) => ({ schema_version: 1, ...rep })),
        });
      } finally {
        progress.end();
      }
    });
}
