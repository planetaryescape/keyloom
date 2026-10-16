// sync and autosync (10#commands, 17): put the head on the keyboard now, show where each keyboard stands, and choose per
// board whether Apply does it by itself. Thin: each calls one use case in src/app.
import type { Command } from "commander";
import {
  type App, type AutoSyncReport, type BoardSyncView, type HandsFreeOverrides, type SyncDeps, autoSyncStatus, pauseAutoSync, runSync, setAutoSync, syncStatus,
} from "../../app/index.ts";
import { type Format, type Io, columns, print } from "../output.ts";
import { untilInterrupted } from "./firmware.ts";

export type SyncCommandDeps = {
  io: Io;
  format: () => Format;
  quiet: () => boolean;
  withApp: <T>(fn: (app: App) => Promise<T> | T) => Promise<T>;
  handsFree?: HandsFreeOverrides;
  /** How a sync builds and flashes; tests pass fakes. */
  syncDeps?: SyncDeps;
};

const seconds = (ms: number | null): number | null => (ms === null ? null : Math.round(ms) / 1000);

/** One line of words for a board's state, as the header says it. */
export function describeSync(v: BoardSyncView): string {
  const s = v.state;
  switch (s.kind) {
    case "in_sync": return `on your ${v.boardName}`;
    case "syncing": return `syncing: ${s.step}`;
    case "behind": {
      const n = s.changes === null ? "changes" : s.changes === 1 ? "1 change" : `${s.changes} changes`;
      const unproven = v.remapper ? "auto-apply is not on yet: prove the exit chord, then run keyloom remap confirm-exit-chord" : "auto-sync is not on yet: it needs one flash that keyloom does and verifies";
      const why = { waiting: "auto-sync will start it", auto_off: "auto-sync is off", paused: "auto-sync is paused", unproven, failed: "the last sync failed", unknown_build: "it runs a keyloom build this copy doesn't know", other_config: "it runs another config; `keyloom config use` puts this one on", changed_since: "something else was flashed since", remapping_off: "remapping is switched off; sync turns it back on" }[s.why];
      return `behind: ${n} not on it (${why})${s.error ? `; ${s.error}` : ""}`;
    }
    case "needs_hand": return `needs a hand: ${s.instruction} (${s.reason})`;
    case "not_connected": return "not connected";
    case "not_keyloom": return `running firmware keyloom didn't build (${s.detail}); keyloom never replaces that by itself`;
  }
}

const boardJson = (v: BoardSyncView) => {
  const s = v.state;
  return {
    board_id: v.boardId, board_name: v.boardName, layout_id: v.layoutId, layout_name: v.layoutName, config_id: v.layoutId, config_name: v.layoutName,
    head_revision_id: v.headRevisionId, other_layouts: v.otherLayouts, other_configs: v.otherLayouts,
    state: s.kind,
    step: s.kind === "syncing" ? s.step : null,
    changes: s.kind === "behind" ? s.changes : null,
    why: s.kind === "behind" ? s.why : null,
    error: s.kind === "behind" ? s.error : null,
    instruction: s.kind === "needs_hand" ? s.instruction : null,
    reason: s.kind === "needs_hand" ? s.reason : null,
    detail: s.kind === "not_keyloom" ? s.detail : null,
    auto_sync: { on: v.auto.on, choice: v.auto.choice, paused: v.auto.paused, proven: v.auto.proven, proven_at: v.auto.provenAt },
    last_sync: v.last && {
      sync_id: v.last.id, trigger: v.last.trigger, status: v.last.status, revision_id: v.last.revisionId, failure: v.last.failure, error: v.last.error,
      started_at: v.last.startedAt, finished_at: v.last.finishedAt,
      timings_s: { wait: seconds(v.last.timings.waitMs), build: seconds(v.last.timings.buildMs), flash: seconds(v.last.timings.flashMs), apply_to_verified: seconds(v.last.timings.totalMs) },
    },
  };
};

const autoJson = (r: AutoSyncReport) => ({ board_id: r.boardId, auto_sync: r.on ? "on" : "off", choice: r.choice, paused: r.paused, proven: r.proven, proven_at: r.provenAt });

const autoLine = (r: AutoSyncReport): string =>
  `${r.boardName}: auto-sync is ${r.on ? "on" : r.paused ? "paused" : "off"}${r.proven ? "" : " (not proven yet: it turns on after one flash that keyloom does by itself and verifies)"}`;

/** One sync of a config and its result in every format; `put` makes the config the one on the keyboard first (`keyloom config use`). */
export async function syncAndPrint(deps: SyncCommandDeps, ref: string, opts: { wait?: boolean; put?: boolean }): Promise<void> {
  const { io, format, quiet, withApp, handsFree, syncDeps } = deps;
  const setup = { ...(handsFree ? { handsFree } : {}), ...(syncDeps ? { deps: syncDeps } : {}) };
  let shown = "";
  const outcome = await untilInterrupted((signal) =>
    withApp((app) =>
      runSync(app, ref, {
        ...(opts.wait ? { wait: true } : {}), ...(opts.put ? { put: true } : {}), ...setup, signal,
        // Progress goes to stderr whatever the format, so a script's stdout stays parseable.
        onStep: (step) => {
          if (step !== shown && !quiet()) io.err(`${(shown = step)}\n`);
        },
      }),
    ),
  );
  const s = outcome.sync;
  print(io, format(), {
    json: {
      status: outcome.status, board_id: outcome.boardId, layout_id: outcome.layoutId, revision_id: outcome.revisionId,
      sync_id: s?.id ?? null, build_id: s?.buildId ?? null, flash_id: s?.flashId ?? null,
      timings_s: s && {
        wait: seconds(s.startedAt - s.appliedAt), build: seconds(s.builtAt === null ? null : s.builtAt - s.startedAt),
        flash: seconds(s.finishedAt === null || s.flashStartedAt === null ? null : s.finishedAt - s.flashStartedAt), apply_to_verified: seconds(s.finishedAt === null ? null : s.finishedAt - s.appliedAt),
      },
    },
    table: quiet() ? (s?.id ?? outcome.revisionId) : outcome.status === "in_sync" ? "already on the keyboard; nothing to do" : `synced ${outcome.revisionId} to ${outcome.boardId}: ${outcome.boardId === "apple/macbook-ansi" ? "kanata reports it loaded" : "the keyboard came back running it"} (${s?.id})`,
    ids: [s?.id ?? outcome.revisionId],
  });
}

export function registerSyncCommands(program: Command, deps: SyncCommandDeps): void {
  const { io, format, quiet, withApp, handsFree, syncDeps } = deps;
  const setup = { ...(handsFree ? { handsFree } : {}), ...(syncDeps ? { deps: syncDeps } : {}) };

  const sync = program.command("sync").description("put a layout's head revision on its keyboard, or show where each keyboard stands");

  sync
    .command("run", { isDefault: true })
    .description("sync the config on the keyboard: build the head, flash it hands-free and check the keyboard came back running it (never replaces firmware keyloom didn't build)")
    .argument("<layout>", "config (layout) ID or name; it must be the one on its keyboard, `keyloom config use` changes that")
    .option("--wait", "if a sync is already running (the server's), wait for it to end first instead of refusing")
    .action((ref: string, opts: { wait?: boolean }) => syncAndPrint(deps, ref, opts));

  sync
    .command("status")
    .description("each board's state: in sync, syncing, behind, needs a hand, not connected, or running firmware keyloom didn't build")
    .action(async () => {
      const boards = await withApp((app) => syncStatus(app, setup));
      print(io, format(), {
        json: { boards: boards.map(boardJson) },
        rows: boards.map((b) => ({ schema_version: 1, ...boardJson(b) })),
        ids: boards.map((b) => b.boardId),
        table: boards.length === 0 ? "no layouts for a board keyloom can sync yet" : columns([["BOARD", "CONFIG ON KEYBOARD", "STATE"], ...boards.map((b) => [b.boardId, b.layoutName, describeSync(b)])]),
      });
    });

  const auto = program.command("autosync").description("whether Apply puts the change on a board by itself (turns on after one flash keyloom did by itself and verified)");

  for (const [name, what] of [["on", "turn auto-sync on for a board"], ["off", "turn auto-sync off for a board"], ["status", "show whether auto-sync is on for a board"], ["pause", "pause auto-sync for a board"], ["resume", "resume a paused auto-sync"]] as const) {
    auto
      .command(name)
      .description(what)
      .argument("<board>", "board ID, such as zsa/moonlander")
      .action(async (board: string) => {
        const r = await withApp((app) => {
          switch (name) {
            case "on": return setAutoSync(app, board, true);
            case "off": return setAutoSync(app, board, false);
            case "pause": return pauseAutoSync(app, board, true);
            case "resume": return pauseAutoSync(app, board, false);
            case "status": return autoSyncStatus(app, board);
          }
        });
        print(io, format(), { json: autoJson(r), table: quiet() ? (r.on ? "on" : "off") : autoLine(r), ids: [r.boardId] });
      });
  }
}
