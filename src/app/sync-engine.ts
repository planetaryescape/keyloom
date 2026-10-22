// The sync engine (17#auto-sync, D-160 to D-169): it keeps each keyboard on its config's head revision. The config is the
// one stored as on the keyboard (D-300), never the newest edited, so editing another config of the board schedules nothing.
//
// It is level-triggered. Every tick it asks, per board, "does the keyboard run the head, and is it time to put it there?"
// from the database and the last reading of USB, so a burst of Applies, an Apply during a sync, a restart mid-sync and a
// keyboard that comes back are all the same question with different answers, and there is no event queue to get out of step.
// One sync runs at a time in the whole machine, enforced by a row in the database (claimSync), not by this object.
import type { DetectedKeyboard } from "./keyboard-detect.ts";
import { join } from "node:path";
import { LogSink } from "../firmware/toolchain/run.ts";
import { processAlive } from "../firmware/toolchain/lock.ts";
import { deepEqual } from "../layout/equal.ts";
import { sameBuild } from "../layout/conditional-backfill.ts";
import { withoutLayerNumbers } from "../layout/layer-refs.ts";
import { type BuildRow, finishBuild, finishFlash, findBuild, findBuildByKey, findFlash, lastSuccessfulFlashAt } from "../persistence/builds.ts";
import { getBoardConfig, setBoardConfig } from "../persistence/configs.ts";
import { type LayoutRow, findLayoutRow, findRevision, listLayoutRows } from "../persistence/layouts.ts";
import {
  type BoardSyncRow, type SyncFinish, type SyncRow, activeSyncs, claimSync, finishSync, findSync, getBoardSync, lastSucceededSync, lastSyncOfBoard, lastSyncOfRevision, newSyncId,
  progressSync, revisionLine, setAutoSyncChoice, setPaused as storePaused,
} from "../persistence/syncs.ts";
import type { FlashNote, FlashState } from "../firmware/toolchain/flash-state.ts";
import { SETUP_REVISION } from "../firmware/kanata/generate.ts";
import { buildKey } from "../firmware/zmk/handsfree.ts";
import { zmkRevision } from "../firmware/zmk/board-config.ts";
import { showBoard } from "./boards.ts";
import type { App } from "./context.ts";
import { NotFoundError, UsageError } from "./errors.ts";
import { firmwareBusy } from "./firmware.ts";
import type { SyncDeps } from "./sync-deps.ts";
import { type KeyboardReading, syncSupported, syncableBoards } from "./sync-keyboard.ts";
import { type SyncFacts, type SyncState, autoSyncDue, deriveState } from "./sync-state.ts";

export type SyncTimings = {
  /** Apply to the start of the sync: the quiet time and any wait for an earlier sync. */
  waitMs: number | null;
  buildMs: number | null;
  flashMs: number | null;
  /** Apply to the verified flash: the time BK waits (the number that decides rung 17). */
  totalMs: number | null;
};

export type SyncRunView = {
  id: string;
  trigger: "auto" | "manual";
  status: SyncRow["status"];
  step: SyncRow["step"];
  revisionId: string;
  failure: SyncRow["failure"];
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  timings: SyncTimings;
};

export type SyncAutoView = {
  /** What auto-sync does now: on, and not paused. */
  on: boolean;
  /** BK's choice, or null when he has not made one, so it follows the proof. */
  choice: boolean | null;
  paused: boolean;
  /** One flash on this board went through the hands-free path and was verified (D-160). */
  proven: boolean;
  provenAt: number | null;
  /** When auto-sync will start a sync if nothing changes, while the board is behind and waiting. */
  dueAt: number | null;
};

export type BoardSyncView = {
  boardId: string;
  boardName: string;
  /** A software remapper (the MacBook's keyboard): applying writes a config and reloads it, with no build or flash. */
  remapper: boolean;
  /** The config on this keyboard (D-300): the one the engine keeps it on, which changes only when BK puts another on. */
  layoutId: string;
  layoutName: string;
  headRevisionId: string;
  /** Other configs of this board that are not archived; putting one on replaces what the keyboard runs. */
  otherLayouts: number;
  state: SyncState;
  auto: SyncAutoView;
  last: SyncRunView | null;
};

export type SyncOptions = {
  /** How long after the last Apply a sync starts (default 3 s, 17#auto-sync). */
  quietMs?: number;
  /** How often the engine looks at the database (default 500 ms). */
  tickMs?: number;
  /** How often it reads USB while idle (default 5 s). */
  pollMs?: number;
  now?: () => number;
  alive?: (pid: number) => boolean;
};

export type SyncNowResult =
  | { kind: "started" | "already_running"; sync: SyncRow; done: Promise<SyncRow> }
  | { kind: "in_sync"; boardId: string; layoutId: string; revisionId: string }
  | { kind: "queued" };

type Running = {
  row: SyncRow;
  abort: AbortController;
  /** Only aborted while nothing has been written: waiting for a hand, or on shutdown. */
  flashAbort: AbortController;
  reason: "paused" | "superseded" | "stopped" | undefined;
  recovering?: true;
  done: Promise<SyncRow>;
};

const ABSENT: KeyboardReading = { state: "absent" };

const isRemapper = (boardId: string): boolean => showBoard(boardId).definition.firmware === "kanata";

const iso = (ms: number): string => new Date(ms).toISOString();

/** What the engine knows about one board when it decides. */
type BoardFacts = { boardId: string; boardName: string; layout: LayoutRow; layouts: LayoutRow[]; reading: KeyboardReading; facts: SyncFacts };

export class SyncEngine {
  readonly id = crypto.randomUUID();
  private readonly quietMs: number;
  private readonly tickMs: number;
  private readonly pollMs: number;
  private readonly now: () => number;
  private readonly alive: (pid: number) => boolean;

  private running: Running | null = null;
  private readings = new Map<string, KeyboardReading>();
  private readAt = Number.NEGATIVE_INFINITY;
  private reading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;
  private started = false;
  private failure: string | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  /** Board to the config a manual sync is waiting to put on. Checked again when it starts: BK may have chosen another since. */
  private readonly pendingManual = new Map<string, string>();
  private readonly listeners = new Set<(boards: BoardSyncView[], newKeyboards: DetectedKeyboard[]) => void>();
  /** Keyboards on USB keyloom has no board for, from the last read (D-336). */
  private unknown: DetectedKeyboard[] = [];
  private lastPublished = "";
  private readonly sameDocument = new Map<string, boolean>();

  constructor(private readonly app: App, private readonly deps: SyncDeps, opts: SyncOptions = {}) {
    this.quietMs = opts.quietMs ?? 3000;
    this.tickMs = opts.tickMs ?? 500;
    this.pollMs = opts.pollMs ?? 5000;
    this.now = opts.now ?? Date.now;
    this.alive = opts.alive ?? processAlive;
  }

  // --- lifecycle ----------------------------------------------------------------------------

  /** Recovers what a stopped engine left, reads the keyboards once, then ticks until stopped. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.exclusive(async () => {
      await this.refresh(true);
      await this.recover();
      this.publish();
    });
    this.schedule();
  }

  /**
   * Stops ticking. A build is stopped, because it has touched nothing; a flash is waited for (up to `flashGraceMs`), because
   * stopping it half-way is how a keyboard is left in its bootloader.
   */
  async stop(opts: { flashGraceMs?: number } = {}): Promise<void> {
    this.stopping = true;
    clearTimeout(this.timer);
    const run = this.running;
    if (!run) return;
    if (run.row.step === "building" || run.row.step === "needs_hand") {
      run.reason = "stopped";
      run.abort.abort();
      run.flashAbort.abort();
    }
    await Promise.race([run.done, Bun.sleep(opts.flashGraceMs ?? 120_000)]);
  }

  private schedule(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick().finally(() => this.schedule()), this.tickMs);
  }

  /** Makes the next decision now instead of at the next tick: an Apply just happened. */
  notifyApplied(): void {
    if (this.started && !this.stopping) void this.tick();
  }

  /** The keyboards on USB keyloom has no board for, as of the last read (D-336). */
  newKeyboards(): DetectedKeyboard[] {
    return this.unknown;
  }

  subscribe(listener: (boards: BoardSyncView[], newKeyboards: DetectedKeyboard[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Everything that decides or starts something runs one at a time, so two ticks (or a tick and a Sync now) can't both start a sync.
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** One look at the keyboards and the database, and a sync if one is due. The timer calls it; tests call it with a clock they hold. */
  tick(): Promise<void> {
    // Never rejects: this runs from timers, where an error nobody catches ends the whole server, and the engine is a guest in it.
    return this.exclusive(async () => {
      if (this.stopping) return;
      try {
        if (!this.running && this.now() - this.readAt >= this.pollMs) await this.refresh(true);
        this.supersedeStale();
        await this.startDue();
        this.publish();
        this.failure = undefined;
      } catch (err) {
        // Said once per kind of failure, not every tick: a database that is gone would otherwise fill the terminal.
        const text = err instanceof Error ? err.message : String(err);
        if (text !== this.failure) console.error(`keyloom: keyboard sync could not check the keyboards: ${text}`);
        this.failure = text;
      }
    });
  }

  // --- reading the keyboards ----------------------------------------------------------------

  private async refresh(force = false): Promise<void> {
    if (!force && this.now() - this.readAt < this.pollMs) return;
    // A read that was already under way began before the caller's reason to look, so a forced read waits it out and then reads again.
    while (this.reading) {
      await this.reading;
      if (!force) return;
    }
    const read = (async () => {
      try {
        this.readings = await this.deps.readKeyboards();
      } catch {
        this.readings = new Map();
      }
      // Best effort: naming a new keyboard must never stop the engine reading the ones it syncs.
      try {
        this.unknown = (await this.deps.newKeyboards?.()) ?? [];
      } catch {
        this.unknown = [];
      }
      this.readAt = this.now();
    })();
    this.reading = read.finally(() => {
      this.reading = null;
    });
    await this.reading;
  }

  private readingOf(boardId: string): KeyboardReading {
    return this.readings.get(boardId) ?? ABSENT;
  }

  // --- facts and views ----------------------------------------------------------------------

  /**
   * Every step from the older revision to the newer one is a recorded-numbers revision or a conditional-layers backfill (D-391), so the
   * two generate the same firmware even though their documents differ. The line is the head's own, so an edit in between is not skipped.
   */
  private sameAlongTheLine(layoutId: string, a: string, b: string): boolean {
    for (const [older, newer] of [[a, b], [b, a]] as const) {
      const line = revisionLine(this.app.db, layoutId, newer);
      const at = line.indexOf(older);
      if (at <= 0) continue;
      const docs = line.slice(0, at + 1).map((id) => findRevision(this.app.db, layoutId, id)?.layout);
      if (docs.every((d) => d !== undefined) && docs.slice(0, -1).every((later, i) => sameBuild(docs[i + 1] as NonNullable<typeof later>, later as NonNullable<typeof later>))) return true;
    }
    return false;
  }

  private documentsEqual(layoutId: string, a: string, b: string): boolean {
    if (a === b) return true;
    const key = `${a}|${b}`;
    const cached = this.sameDocument.get(key);
    if (cached !== undefined) return cached;
    const left = findRevision(this.app.db, layoutId, a);
    const right = findRevision(this.app.db, layoutId, b);
    const same = left !== undefined && right !== undefined && (deepEqual(withoutLayerNumbers(left.layout), withoutLayerNumbers(right.layout)) || this.sameAlongTheLine(layoutId, a, b));
    // The recorded layer numbers (D-378) don't change what is generated for a layout whose keys and kept code are the same, so a
    // head that differs only in them is what the keyboard already runs. Revisions never change, so a verdict never goes stale.
    this.sameDocument.set(key, same);
    return same;
  }

  private factsFor(boardId: string, boardName: string, layouts: LayoutRow[], over?: LayoutRow): BoardFacts | null {
    if (layouts.length === 0) return null;
    const reading = this.readingOf(boardId);
    const db = this.app.db;

    // A software remapper names the revision it loaded; there are no builds to look up.
    const loaded = reading.state === "keyloom" ? reading.revisionId : undefined;
    let builds: Array<BuildRow | undefined> = [];
    if (reading.state === "keyloom" && loaded === undefined) builds = reading.keys.map((k) => findBuildByKey(db, k));
    const known = reading.state === "keyloom" && loaded === undefined && builds.length > 0 && builds.every((b): b is BuildRow => b !== undefined);
    // The board always has a stored config (createLayout and the migration write one); the newest is only a guard for a database edited by hand.
    const newest = [...layouts].sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1))[0] as LayoutRow;
    const stored = getBoardConfig(db, boardId);
    const ofRunning = known ? layouts.find((l) => l.id === (builds[0] as BuildRow).layoutId) : loaded === undefined ? undefined : layouts.find((l) => findRevision(db, l.id, loaded) !== undefined);
    const layout = over ?? layouts.find((l) => l.id === stored) ?? newest;

    let running: SyncFacts["running"] = { kind: "unknown" };
    if (loaded === SETUP_REVISION) {
      // keyloom's own identity file, written by setup before any Apply: behind by definition, and keyloom's to replace.
      running = { kind: "behind", changes: null };
    } else if (loaded !== undefined && ofRunning && ofRunning.id !== layout.id) {
      // The keyboard runs another config of this board. This one is stored as on the keyboard, but replacing what runs is a choice BK makes (D-300).
      running = { kind: "other_config" };
    } else if (loaded !== undefined && ofRunning && ofRunning.id === layout.id) {
      const head = layout.headRevisionId;
      if (this.documentsEqual(layout.id, loaded, head)) running = { kind: "same" };
      else {
        const at = revisionLine(db, layout.id, head).indexOf(loaded);
        running = { kind: "behind", changes: at < 0 ? null : at };
      }
    } else if (known && reading.state === "keyloom") {
      const all = builds as BuildRow[];
      if (all.some((b) => b.layoutId !== layout.id) && all.every((b) => layouts.some((l) => l.id === b.layoutId))) {
        running = { kind: "other_config" };
      } else if (all.every((b) => b.layoutId === layout.id)) {
        const head = layout.headRevisionId;
        const behind = all.filter((b) => !this.documentsEqual(layout.id, b.revisionId, head));
        if (behind.length === 0) running = { kind: "same" };
        else {
          const line = revisionLine(db, layout.id, head);
          const at = behind.map((b) => line.indexOf(b.revisionId));
          running = { kind: "behind", changes: at.some((i) => i < 0) ? null : Math.max(...at) };
        }
      }
    }

    // Unplugged, the keyboard can't be read, so what it last ran is the last build keyloom put on it (null count when that revision is
    // off the head's line).
    let lastKnown: SyncFacts["lastKnown"];
    if (reading.state === "absent") {
      const last = lastSucceededSync(db, boardId);
      if (last !== undefined && last.layoutId === layout.id) {
        const head = layout.headRevisionId;
        const at = revisionLine(db, layout.id, head).indexOf(last.revisionId);
        lastKnown = { changes: this.documentsEqual(layout.id, last.revisionId, head) ? 0 : at < 0 ? null : at };
      }
    }

    const bs = getBoardSync(db, boardId);
    const proven = bs.provenAt !== null;
    const active = activeSyncs(db).find((s) => s.boardId === boardId);
    const definition = showBoard(boardId).definition;
    // Every expected half must be visible; one head marker cannot supersede a failed partial flash.
    const flashed = known && reading.state === "keyloom" && !reading.missingHalves?.length && running.kind !== "other_config"
      ? builds.map((build) => lastSuccessfulFlashAt(db, build!.id)) : [];
    const runningFlashedAt = flashed.length > 0 && flashed.every((at): at is number => at !== undefined) ? Math.min(...flashed) : undefined;
    const facts: SyncFacts = {
      ...(runningFlashedAt === undefined ? {} : { runningFlashedAt }),
      reading, running, active, headSync: lastSyncOfRevision(db, boardId, layout.headRevisionId), latestSync: lastSyncOfBoard(db, boardId),
      split: definition.firmware === "zmk" && zmkRevision(definition).flash.steps.length > 1,
      auto: { on: proven && (bs.autoSync ?? true), paused: bs.paused, proven },
      quiet: this.now() - layout.updatedAt >= this.quietMs,
      ...(lastKnown === undefined ? {} : { lastKnown }),
    };
    return { boardId, boardName, layout, layouts, reading, facts };
  }

  private allFacts(): BoardFacts[] {
    const rows = listLayoutRows(this.app.db);
    const out: BoardFacts[] = [];
    for (const board of syncableBoards()) {
      const f = this.factsFor(board.definition.id, board.definition.name, rows.filter((l) => l.boardId === board.definition.id));
      if (f) out.push(f);
    }
    return out;
  }

  private timingsOf(s: SyncRow): SyncTimings {
    const span = (from: number | null, to: number | null) => (from !== null && to !== null ? Math.max(0, to - from) : null);
    return {
      waitMs: span(s.appliedAt, s.startedAt), buildMs: span(s.startedAt, s.builtAt), flashMs: span(s.flashStartedAt, s.finishedAt),
      totalMs: s.status === "succeeded" ? span(s.appliedAt, s.finishedAt) : null,
    };
  }

  private runView(s: SyncRow): SyncRunView {
    return {
      id: s.id, trigger: s.trigger, status: s.status, step: s.step, revisionId: s.revisionId, failure: s.failure, error: s.error,
      startedAt: s.startedAt, finishedAt: s.finishedAt, timings: this.timingsOf(s),
    };
  }

  /** One view per board that has a layout, for the header and `keyloom sync status`. */
  views(): BoardSyncView[] {
    return this.allFacts().map((b) => this.viewOf(b));
  }

  private viewOf(b: BoardFacts): BoardSyncView {
    const state = deriveState(b.facts);
    const bs = getBoardSync(this.app.db, b.boardId);
    const last = lastSyncOfBoard(this.app.db, b.boardId);
    return {
      boardId: b.boardId, boardName: b.boardName, remapper: isRemapper(b.boardId), layoutId: b.layout.id, layoutName: b.layout.name, headRevisionId: b.layout.headRevisionId,
      otherLayouts: b.layouts.filter((l) => l.id !== b.layout.id && l.archivedAt === null).length, state,
      auto: {
        on: b.facts.auto.on && !b.facts.auto.paused, choice: bs.autoSync, paused: bs.paused, proven: bs.provenAt !== null, provenAt: bs.provenAt,
        dueAt: state.kind === "behind" && state.why === "waiting" ? b.layout.updatedAt + this.quietMs : null,
      },
      last: last ? this.runView(last) : null,
    };
  }

  private publish(): void {
    if (this.listeners.size === 0) return;
    const boards = this.views();
    const text = JSON.stringify([boards, this.unknown]);
    if (text === this.lastPublished) return;
    this.lastPublished = text;
    for (const l of this.listeners) l(boards, this.unknown);
  }

  /** The current views after a fresh read of the keyboards. */
  async snapshot(): Promise<BoardSyncView[]> {
    await this.exclusive(() => this.refresh(this.readAt === Number.NEGATIVE_INFINITY));
    return this.views();
  }

  // --- deciding ------------------------------------------------------------------------------

  /** A build of a revision that is no longer the head is a build nobody wants: stop it, and the next sync takes the head. */
  private supersedeStale(): void {
    const run = this.running;
    if (!run || run.reason !== undefined || run.row.step !== "building") return;
    const layout = findLayoutRow(this.app.db, run.row.layoutId);
    if ((layout && layout.headRevisionId !== run.row.revisionId) || this.configChanged(run.row)) {
      run.reason = "superseded";
      run.abort.abort();
    }
  }

  /** BK put another config on this board's keyboard while this sync was under way: what it carries is no longer wanted there. */
  private configChanged(row: SyncRow): boolean {
    return getBoardConfig(this.app.db, row.boardId) !== row.layoutId;
  }

  private async startDue(): Promise<void> {
    if (this.running || this.stopping) return;
    if (activeSyncs(this.app.db).some((s) => this.alive(s.pid))) return; // another process is syncing
    if (firmwareBusy(this.app)) return;

    for (const [boardId, layoutId] of [...this.pendingManual]) {
      this.pendingManual.delete(boardId);
      const layout = findLayoutRow(this.app.db, layoutId);
      if (!layout || getBoardConfig(this.app.db, boardId) !== layoutId) continue;
      await this.refresh(true);
      const b = this.factsFor(boardId, showBoard(boardId).definition.name, listLayoutRows(this.app.db).filter((l) => l.boardId === boardId), layout);
      if (b && deriveState(b.facts).kind !== "in_sync" && b.reading.state !== "absent" && b.reading.state !== "other") {
        if (this.launch(b, "manual")) return;
      }
    }

    const due = this.allFacts().filter((b) => autoSyncDue(b.facts)).sort((a, b) => a.layout.updatedAt - b.layout.updatedAt)[0];
    if (!due) return;
    // The reading may be seconds old; a keyboard swapped for another firmware or unplugged since must not be acted on.
    await this.refresh(true);
    const fresh = this.allFacts().find((b) => b.boardId === due.boardId);
    if (fresh && autoSyncDue(fresh.facts)) this.launch(fresh, "auto");
  }

  // --- running a sync -------------------------------------------------------------------------

  private launch(b: BoardFacts, trigger: "auto" | "manual"): Running | null {
    if (b.reading.state !== "keyloom" && !(trigger === "manual" && (b.reading.state === "bootloader" || b.reading.state === "remapping_off"))) return null;
    const id = newSyncId();
    const claim = claimSync(this.app.db, {
      id, boardId: b.boardId, layoutId: b.layout.id, revisionId: b.layout.headRevisionId,
      boardRevision: b.reading.state === "keyloom" ? b.reading.boardRevision : this.boardRevisionOf(b.boardId), trigger, logPath: `logs/sync-${id}.log`,
      appliedAt: b.layout.updatedAt, owner: this.id, now: this.now(),
    }, this.alive);
    if ("busy" in claim) return null;
    const run: Running = { row: claim.claimed, abort: new AbortController(), flashAbort: new AbortController(), reason: undefined, done: undefined as never };
    run.done = this.execute(run).catch((err: unknown) => {
      // The row stays as it was; the next engine's recovery finishes it.
      console.error(`keyloom: a keyboard sync stopped unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
      return run.row;
    }).finally(() => {
      this.running = null;
      // A finished sync may leave the keyboard behind a newer head: look again at once instead of at the next tick.
      // Only an engine that was started decides things on its own: a one-shot `keyloom sync` does what it was asked and nothing more.
      if (this.started && !this.stopping) setTimeout(() => void this.tick(), 0);
    });
    this.running = run;
    return run;
  }

  /** A keyboard in its bootloader doesn't say which revision it is; the last sync's is the best guess, and the flasher refuses a binary for the wrong one. */
  private boardRevisionOf(boardId: string): string {
    return lastSyncOfBoard(this.app.db, boardId)?.boardRevision ?? showBoard(boardId).definition.revisions[0]?.id ?? "";
  }

  private async execute(run: Running): Promise<SyncRow> {
    const { row } = run;
    const db = this.app.db;
    const log = new LogSink(join(this.app.dataDir, row.logPath));
    const say = (event: string) => log.line(`${iso(this.now())} ${event} (+${this.now() - row.appliedAt} ms since Apply)`);
    const finish = (result: SyncFinish): SyncRow => {
      finishSync(db, row.id, result, this.now());
      say(result.status === "succeeded" ? "verified: the keyboard runs the head revision" : `${result.status} (${result.failure}): ${result.error}`);
      this.publish();
      return findSync(db, row.id) as SyncRow;
    };
    const cancelled = (): SyncRow => finish({ status: "cancelled", failure: run.reason === "superseded" ? "superseded" : "cancelled", error: run.reason === "paused" ? "auto-sync was paused" : run.reason === "stopped" ? "keyloom was stopped" : this.configChanged(row) ? "another config was put on the keyboard" : "the layout changed again" });
    // Looked at again right before anything touches the keyboard: the tick that would stop a build may not have run yet, and a flash
    // of the config BK just took off the keyboard is the one mistake this engine must not make (D-300).
    const unwanted = (): boolean => {
      if (run.reason === undefined && this.configChanged(row)) {
        run.reason = "superseded";
        run.abort.abort();
      }
      return run.reason !== undefined;
    };
    try {
      say(`${row.trigger} sync ${row.id} of ${row.revisionId} for ${row.boardId} ${row.boardRevision} started`);
      this.publish();

      // A software remapper has no build or flash: one apply writes the file, checks it, reloads it and reads it back (21).
      if (isRemapper(row.boardId)) {
        const remapper = this.deps.remapper;
        if (!remapper) return finish({ status: "failed", failure: "flash", error: "this copy of keyloom can't apply to a software remapper" });
        if (unwanted()) return cancelled();
        progressSync(db, row.id, { status: "flashing", step: "writing", builtAt: this.now(), flashStartedAt: this.now() });
        this.publish();
        const applied = await remapper.apply({ layoutId: row.layoutId, revisionId: row.revisionId });
        // Read what kanata runs now, so the header never shows the state from before the apply.
        await this.exclusive(() => this.refresh(true));
        if (run.reason !== undefined) return cancelled();
        if (applied.ok) {
          say(`applied in ${applied.ms} ms`);
          return finish({ status: "succeeded" });
        }
        // Not running is the world changing (retry when it is back); a refused or unreadable config would fail the same way again.
        const failure = applied.step === "not_connected" ? "disconnected" : applied.step === "verify" ? "verify" : applied.step === "reload" || applied.step === "check" || applied.step === "generate" ? "build" : "flash";
        return finish({ status: "failed", failure, error: applied.error });
      }

      const built = await this.deps.build({
        layoutId: row.layoutId, revisionId: row.revisionId, boardRevision: row.boardRevision, signal: run.abort.signal,
        onBuildId: (id) => progressSync(db, row.id, { buildId: id }),
      });
      if (unwanted()) return cancelled();
      if (!built.ok) return finish({ status: "failed", failure: "build", error: built.error });
      say(built.reused ? `build ${built.buildId} reused` : `build ${built.buildId} done`);

      // Nothing has touched the keyboard yet. Look at it once more: it may have been unplugged or reflashed by someone else during the build.
      await this.exclusive(() => this.refresh(true));
      const now = this.readingOf(row.boardId);
      if (now.state === "absent") return finish({ status: "failed", failure: "disconnected", error: "The keyboard was unplugged during the build, so nothing was flashed." });
      if (now.state === "other") return finish({ status: "failed", failure: "flash", error: "The keyboard now runs firmware keyloom didn't build, so keyloom left it alone." });
      if (unwanted()) return cancelled();

      progressSync(db, row.id, { status: "flashing", step: "restarting", builtAt: this.now(), flashStartedAt: this.now() });
      this.publish();
      const flashed = await this.deps.flash({
        buildId: built.buildId, signal: run.flashAbort.signal,
        onFlashId: (id) => progressSync(db, row.id, { flashId: id }),
        onFlasherState: (state, instruction, note) => this.onFlasherState(row, state, instruction, note),
      });

      if (!flashed.ok) {
        if (run.reason !== undefined && !run.recovering) return cancelled();
        const stepNow = findSync(db, row.id)?.step;
        await this.exclusive(() => this.refresh(true));
        const after = this.readingOf(row.boardId);
        const failure = run.recovering ? "flash" : stepNow === "needs_hand" ? "needs_hand" : after.state === "absent" ? "disconnected" : "flash";
        return finish({ status: "failed", failure, error: flashed.error });
      }
      if (!flashed.verified) {
        return finish({ status: "failed", failure: "verify", error: "keyloom flashed the keyboard but couldn't confirm it is running this build, because the build carries no marker. It is not counted as in sync." });
      }
      // The flasher saw the marker come back. Read it once more, so a keyboard that went back to something else is not reported as in sync.
      await this.exclusive(() => this.refresh(true));
      const after = this.readingOf(row.boardId);
      let key: string | undefined;
      try {
        key = buildKey(built.buildId);
      } catch {
        key = undefined;
      }
      if (!(after.state === "keyloom" && !after.missingHalves?.length && key !== undefined && after.keys.length === 1 && after.keys[0] === key)) {
        return finish({ status: "failed", failure: "verify", error: `The flash finished, but afterwards the keyboard is not running build ${built.buildId}.` });
      }
      return finish({ status: "succeeded" });
    } catch (err) {
      return finish({ status: "failed", failure: "flash", error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      log.close();
    }
  }

  private onFlasherState(row: SyncRow, state: FlashState, instruction: string | null, note: FlashNote | undefined): void {
    if (note?.recovering && this.running?.row.id === row.id) this.running.recovering = true;
    if (state === "succeeded" || state === "failed") return;
    // The instruction of a failed hand-off stays on the row (finishSync keeps it for needs_hand), so the header can still show what to do.
    if (note?.needsHand) progressSync(this.app.db, row.id, { step: "needs_hand", instruction });
    else if (note?.verifying) progressSync(this.app.db, row.id, { step: "verifying", instruction: null });
    else if (state === "writing") progressSync(this.app.db, row.id, { step: "writing", instruction: null });
    else progressSync(this.app.db, row.id, { step: "restarting", instruction: null });
    this.publish();
  }

  // --- what a person asks for -----------------------------------------------------------------

  /**
   * Sync now: puts the head of the config on its board's keyboard, whatever the auto-sync setting. It still refuses a keyboard
   * running firmware keyloom didn't build, because replacing that takes the flash dialog's confirmation (D-094). It refuses a config
   * that is not the one on the keyboard: changing that is `useConfig`, a choice of its own (D-300).
   */
  syncNow(layoutRef: string): Promise<SyncNowResult> {
    return this.exclusive(() => this.syncLocked(layoutRef, false));
  }

  /**
   * Makes `layoutRef` the config on its board's keyboard and syncs it once (D-300). The checks are `syncNow`'s, and they run before
   * the choice is stored, so a keyboard that is unplugged or running someone else's firmware leaves the choice as it was.
   */
  useConfig(layoutRef: string): Promise<SyncNowResult> {
    return this.exclusive(() => this.syncLocked(layoutRef, true));
  }

  private async syncLocked(layoutRef: string, put: boolean): Promise<SyncNowResult> {
    const layout = findLayoutRow(this.app.db, layoutRef);
    if (!layout) throw new NotFoundError(`no layout "${layoutRef}"`);
    if (layout.archivedAt !== null) throw new UsageError(`${layout.name} is archived; restore it first with \`keyloom config restore ${layout.name}\``);
    const onKeyboard = getBoardConfig(this.app.db, layout.boardId);
    if (!put && onKeyboard !== layout.id) {
      const current = onKeyboard === undefined ? undefined : findLayoutRow(this.app.db, onKeyboard);
      throw new UsageError(`${layout.name} isn't the config on your ${showBoard(layout.boardId).definition.name}${current ? ` (${current.name} is)` : ""}; put it on with \`keyloom config use ${layout.name}\``);
    }
    const board = showBoard(layout.boardId);
    const name = board.definition.name;
    if (!syncSupported(board)) {
      throw new UsageError(`keyloom can't tell what a ${name} is running or restart it by itself, so it can't sync it. Use \`keyloom build\` and \`keyloom flash\`.`);
    }
    await this.refresh(true);
    const reading = this.readingOf(board.definition.id);
    if (reading.state === "absent") {
      throw new UsageError(board.definition.firmware === "kanata"
        ? `kanata isn't running for the ${name}, so keyloom can't apply to it. Run \`keyloom doctor\` to see what is missing`
        : `no ${name} is attached; plug it in and try again`);
    }
    if (reading.state === "other" && board.definition.firmware === "kanata") {
      throw new UsageError(`kanata is running a config keyloom didn't write (${reading.detail}). keyloom never replaces it by itself: apply with \`keyloom remap apply ${layout.name} --overwrite\` to do it deliberately.`);
    }
    if (reading.state === "other") {
      throw new UsageError(`the ${name} is running firmware keyloom didn't build (${reading.detail}). keyloom never replaces that by itself: run \`keyloom build ${layout.name}\` and \`keyloom flash --layout ${layout.name}\` to do it deliberately.`);
    }

    const run = this.running;
    if (!run) {
      const other = activeSyncs(this.app.db).find((s) => this.alive(s.pid));
      if (other) throw new UsageError(`another keyloom sync is running (${other.id}, process ${other.pid}); wait for it or use --wait`);
      if (firmwareBusy(this.app)) throw new UsageError("a build or flash is in progress; wait for it to finish");
    }

    // Stored before anything starts, so the sync's own checks (and a tick between) see the config it is for.
    const previous = onKeyboard;
    if (put) setBoardConfig(this.app.db, board.definition.id, layout.id);
    if (run) {
      const sameBoard = run.row.boardId === board.definition.id;
      if (sameBoard && run.row.layoutId === layout.id && run.row.revisionId === layout.headRevisionId) return { kind: "already_running", sync: run.row, done: run.done };
      this.pendingManual.set(board.definition.id, layout.id);
      return { kind: "queued" };
    }

    const b = this.factsFor(board.definition.id, name, listLayoutRows(this.app.db).filter((l) => l.boardId === board.definition.id), layout);
    const launched = b && deriveState(b.facts).kind !== "in_sync" ? this.launch(b, "manual") : null;
    if (!b || (!launched && deriveState(b.facts).kind !== "in_sync")) {
      if (put && previous !== undefined) setBoardConfig(this.app.db, board.definition.id, previous);
      if (!b) throw new NotFoundError(`no layout "${layoutRef}"`);
      throw new UsageError(`the ${name} can't be synced right now`);
    }
    if (!launched) return { kind: "in_sync", boardId: board.definition.id, layoutId: layout.id, revisionId: layout.headRevisionId };
    this.publish();
    return { kind: "started", sync: launched.row, done: launched.done };
  }

  /** "Disable remapping": the identity map goes on, so the built-in keyboard types as a plain one. No sudo (D-235). */
  async disableRemapping(boardId: string): Promise<void> {
    const board = showBoard(boardId);
    if (board.definition.firmware !== "kanata") throw new UsageError(`${board.definition.name} isn't a software remapper, so there is nothing to disable`);
    const remapper = this.deps.remapper;
    if (!remapper) throw new UsageError("this copy of keyloom can't reach the remapper");
    // An apply under way would load its file after the identity map and undo it.
    await this.exclusive(async () => {
      const run = this.running;
      if (run && run.row.boardId === boardId) await run.done;
      const r = await remapper.disable(boardId);
      if (!r.ok) throw new UsageError(`couldn't disable remapping: ${r.error}. If kanata is stuck, hold Left Control + Space + Escape to stop it`);
      await this.refresh(true);
      this.publish();
    });
  }

  private requireSyncable(boardId: string): void {
    const board = showBoard(boardId);
    if (!syncSupported(board)) throw new UsageError(`${board.definition.name} can't be synced by keyloom`);
  }

  /** What BK chose for a board and what has been proven, without changing anything. */
  settings(boardId: string): BoardSyncRow {
    this.requireSyncable(boardId);
    return getBoardSync(this.app.db, boardId);
  }

  /** Turns auto-sync on or off. It can turn on only after a flash on this board that keyloom did by itself and verified (D-160). */
  setAutoSync(boardId: string, on: boolean): BoardSyncRow {
    this.requireSyncable(boardId);
    const bs = getBoardSync(this.app.db, boardId);
    if (on && bs.provenAt === null && isRemapper(boardId)) {
      throw new UsageError("auto-apply turns on after you have proved kanata's emergency exit once: hold Left Control + Space + Escape, see kanata stop, then run `keyloom remap confirm-exit-chord`");
    }
    if (on && bs.provenAt === null) {
      throw new UsageError(
        `auto-sync can turn on once keyloom has flashed this board by itself and seen the new firmware come back. Sync it by hand once (\`keyloom sync <layout>\`); if that flash needs no keypress, auto-sync turns on.`,
      );
    }
    setAutoSyncChoice(this.app.db, boardId, on);
    this.afterChange();
    return getBoardSync(this.app.db, boardId);
  }

  /** Pause stops auto-sync starting anything, and stops a build of its own that has not reached the keyboard. */
  setPaused(boardId: string, paused: boolean): BoardSyncRow {
    this.requireSyncable(boardId);
    storePaused(this.app.db, boardId, paused);
    const run = this.running;
    if (paused && run && run.row.boardId === boardId && run.row.trigger === "auto" && run.reason === undefined) {
      const step = findSync(this.app.db, run.row.id)?.step;
      if (step === "building" || step === "needs_hand") {
        run.reason = "paused";
        run.abort.abort();
        run.flashAbort.abort();
      }
    }
    this.afterChange();
    return getBoardSync(this.app.db, boardId);
  }

  private afterChange(): void {
    this.publish();
    if (this.started && !this.stopping) void this.tick();
  }

  // --- restart ---------------------------------------------------------------------------------

  /**
   * A sync the last engine left running. A build had touched nothing, so it is simply over. A flash may have finished: the
   * keyboard says so with its marker, and only then is it counted, so a restart never flashes the same build twice.
   */
  private async recover(): Promise<void> {
    const db = this.app.db;
    for (const row of activeSyncs(db)) {
      const orphan = !this.alive(row.pid) || (row.pid === process.pid && row.owner !== this.id);
      if (!orphan) continue;
      const build = row.buildId ? findBuild(db, row.buildId) : undefined;
      if (build?.status === "running") finishBuild(db, build.id, { error: "keyloom stopped before this build finished." });
      const flash = row.flashId ? findFlash(db, row.flashId) : undefined;
      if (flash && (flash.status === "waiting_for_bootloader" || flash.status === "writing")) {
        finishFlash(db, flash.id, { error: "keyloom stopped before this flash finished. Nothing is known about the keyboard's state: reconnect it, and flash again if it doesn't type." });
      }
      if (row.status === "flashing" && row.buildId) {
        const reading = this.readingOf(row.boardId);
        let key: string | undefined;
        try {
          key = buildKey(row.buildId);
        } catch {
          key = undefined;
        }
        if (reading.state === "keyloom" && !reading.missingHalves?.length && key !== undefined && reading.keys.length === 1 && reading.keys[0] === key) {
          finishSync(db, row.id, { status: "succeeded" }, this.now());
          continue;
        }
      }
      finishSync(db, row.id, { status: "failed", failure: "interrupted", error: "keyloom stopped before this sync finished." }, this.now());
    }
  }
}
