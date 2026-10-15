// generate, build and flash (10#commands). Thin: each calls one use case in src/app.
import type { Command } from "commander";
import {
  type App, type BuildView, type FlashView, type HandsFreeDeps, buildAndWait, flashAndWait, generateFirmware, rebootKeyboard, UsageError,
} from "../../app/index.ts";
import { type Format, type Io, columns, print } from "../output.ts";

export type FirmwareCommandDeps = {
  io: Io;
  format: () => Format;
  quiet: () => boolean;
  withApp: <T>(fn: (app: App) => Promise<T> | T) => Promise<T>;
  /** How a ZSA keyboard is found and restarted; tests pass fakes. */
  handsFree?: Partial<HandsFreeDeps>;
};

/** Ctrl-C aborts the work instead of killing keyloom and leaving docker or zapp running on its own. */
export async function untilInterrupted<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    return await fn(controller.signal);
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

/** One line that rewrites itself, so a build of thousands of lines shows where it is without scrolling. */
export function progressLine(io: Io): { write: (line: string) => void; end: () => void } {
  if (!io.isTTY) return { write: () => undefined, end: () => undefined };
  const width = Math.max(20, (process.stderr.columns ?? 100) - 1);
  let drawn = false;
  return {
    write: (line) => {
      const text = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (text === "") return;
      io.err(`\r\x1b[K${text.length > width ? `${text.slice(0, width - 1)}…` : text}`);
      drawn = true;
    },
    end: () => {
      if (drawn) io.err("\r\x1b[K");
      drawn = false;
    },
  };
}

const buildJson = (b: BuildView) => ({
  build_id: b.id, status: b.status, layout_id: b.layoutId, revision_id: b.revisionId, board_revision: b.boardRevision,
  artifact_path: b.artifactPath, log_path: b.logPath, error: b.error, started_at: b.startedAt, finished_at: b.finishedAt,
});

const flashJson = (f: FlashView) => ({
  flash_id: f.id, build_id: f.buildId, status: f.status, error: f.error, note: f.note, log_path: f.logPath, started_at: f.startedAt, finished_at: f.finishedAt,
});

export function registerFirmwareCommands(program: Command, deps: FirmwareCommandDeps): void {
  const { io, format, quiet, withApp, handsFree } = deps;

  program
    .command("generate")
    .description("write the firmware source for a layout without building it (QMK keymap files, or ZMK's <name>.keymap and <name>.conf)")
    .argument("<layout>", "layout ID or name")
    .requiredOption("--out <dir>", "directory to write the source files into")
    .option("--rev <revision>", "a revision ID instead of the head")
    .option("--board-rev <revision>", "board revision, such as reva or revb (QMK boards with several)")
    .action(async (ref: string, opts: { out: string; rev?: string; boardRev?: string }) => {
      const r = await withApp((app) =>
        generateFirmware(app, ref, { out: opts.out, ...(opts.rev ? { rev: opts.rev } : {}), ...(opts.boardRev ? { boardRevision: opts.boardRev } : {}) }),
      );
      print(io, format(), {
        json: { layout_id: r.layoutId, revision_id: r.revisionId, dir: r.dir, files: r.files },
        table: quiet() ? r.dir : `wrote ${r.files.join(", ")} to ${r.dir} (revision ${r.revisionId})`,
        ids: [r.dir],
      });
    });

  program
    .command("build")
    .description("generate and build; prints the build ID and artifact path")
    .argument("<layout>", "layout ID or name")
    .option("--rev <revision>", "a revision ID instead of the head")
    .option("--board-rev <revision>", "board revision, such as reva or revb (detected from a connected keyboard when omitted)")
    .action(async (ref: string, opts: { rev?: string; boardRev?: string }) => {
      const progress = progressLine(io);
      try {
        const b = await untilInterrupted((signal) =>
          withApp((app) =>
            buildAndWait(app, ref, {
              ...(opts.rev ? { revisionId: opts.rev } : {}),
              ...(opts.boardRev ? { boardRevision: opts.boardRev } : {}),
              onProgress: progress.write,
              signal,
            }),
          ),
        );
        progress.end();
        print(io, format(), {
          json: buildJson(b),
          table: quiet() ? b.id : `${b.id}\nartifact: ${b.artifactPath}\nlog: ${b.logPath}\nbuilt for ${b.boardRevision} in ${(((b.finishedAt ?? b.startedAt) - b.startedAt) / 1000).toFixed(0)} s`,
          ids: [b.id],
        });
      } finally {
        progress.end();
      }
    });

  program
    .command("flash")
    .description("flash the newest successful build of a layout, or a given build (with zapp, or by copying to a UF2 boot drive per half)")
    .option("--build <build>", "a build ID")
    .option("--layout <layout>", "flash the newest successful build of this layout")
    .option("--volumes-root <dir>", "the folder UF2 boot drives appear in (default: /Volumes on macOS, found with lsblk on Linux); boards that flash to UF2 drives only")
    .option("--reboot-only", "only restart the attached keyboard into its bootloader (it must be running a keyloom build); flashes nothing, and the keyboard stays in the bootloader until it is flashed or unplugged")
    .option("--board <board>", "with --reboot-only: which board, when more than one is attached")
    .action(async (opts: { build?: string; layout?: string; volumesRoot?: string; rebootOnly?: boolean; board?: string }) => {
      if (opts.build !== undefined && opts.layout !== undefined) throw new UsageError("pass --build or --layout, not both");
      if (opts.rebootOnly) {
        if (opts.build !== undefined || opts.layout !== undefined) throw new UsageError("--reboot-only flashes nothing; leave out --build and --layout");
        const r = await rebootKeyboard({ ...(opts.board ? { board: opts.board } : {}), ...(handsFree ? { handsFree } : {}), onLine: (line) => io.err(`${line}\n`) });
        print(io, format(), {
          json: { board: r.board, board_revision: r.revision, previous_firmware: r.previousFirmware, bootloader: r.bootloader },
          table: quiet() ? r.board : `${r.board} ${r.revision} is in its bootloader (${r.bootloader}); it was running ${r.previousFirmware}. Flash it, or unplug it and plug it in again to leave the bootloader.`,
          ids: [r.board],
        });
        return;
      }
      let shown: string | null = null;
      const f = await untilInterrupted((signal) =>
        withApp((app) =>
          flashAndWait(app, {
            ...(opts.build ? { buildId: opts.build } : {}),
            ...(opts.layout ? { layout: opts.layout } : {}),
            ...(opts.volumesRoot ? { volumesRoot: opts.volumesRoot } : {}),
            ...(handsFree ? { handsFree } : {}),
            signal,
            // The instruction is the point: it goes to stderr whatever the format, so a script's stdout stays parseable.
            onState: (flash) => {
              if (flash.instruction && flash.instruction !== shown) io.err(`${(shown = flash.instruction)}\n`);
            },
          }),
        ),
      );
      print(io, format(), {
        json: flashJson(f),
        table: quiet() ? f.id : columns([["flash", f.id], ["build", f.buildId], ["status", f.status], ...(f.note ? [["result", f.note] as [string, string]] : []), ["log", f.logPath]]),
        ids: [f.id],
      });
    });
}
