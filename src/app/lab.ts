// Use cases for the typing lab (D-280 to D-283, 24-typing-lab.md): record a session from the connected keyboard, keep it, analyse it by
// replaying it through the real firmware logic, propose what that proves as ordinary change sets, and delete it.
// Hardware and the emulator are parameters (LabDeps), so the CLI's end-to-end test runs on a fake keyboard and a model.
import type { BoardDefinition } from "../boards/schema.ts";
import type { TypingFindings } from "../agent/ports.ts";
import type { CaptureHooks, CapturedTrace, KeyCapture } from "../firmware/emulate/trace.ts";
import { findQmkStreamDevice, startQmkCapture } from "../firmware/qmk/typing-capture.ts";
import { defaultHidTransport } from "../firmware/toolchain/hid-default.ts";
import { defaultSerialTransport } from "../firmware/toolchain/serial-default.ts";
import { findZmkStreamPort, startZmkCapture } from "../firmware/zmk/typing-capture.ts";
import { CaptureError } from "../firmware/emulate/trace.ts";
import { LogSink } from "../firmware/toolchain/run.ts";
import { type Analysis, type Replay, analyse } from "../lab/analyse.ts";
import { builtinPassages, customPassage, passageLines } from "../lab/passages.ts";
import type { Passage } from "../lab/passage-types.ts";
import { keyName } from "../lab/sentences.ts";
import type { Example, Suggestion } from "../lab/search.ts";
import { prepareEvents } from "../lab/replay-input.ts";
import type { Layout } from "../layout/schema.ts";
import {
  type TypingSessionRow, type TypingSessionSummary, deleteTypingSession, findTypingSession, insertTypingSession, listTypingSessions, saveAnalysis,
} from "../persistence/typing-sessions.ts";
import { transact } from "../persistence/transaction.ts";
import { rejectChange, proposeChange } from "./changes.ts";
import { toCard } from "./proposal-card.ts";
import { findChangeSet } from "../persistence/change-sets.ts";
import { tappingTermOf } from "../lab/terms.ts";

import type { App } from "./context.ts";
import { emulateEvents } from "./emulate.ts";
import { NotFoundError, UsageError, ValidationFailedError } from "./errors.ts";
import { type LayoutView, getLayout } from "./layouts.ts";
import { rm } from "node:fs/promises";
import { join } from "node:path";

export type LabDeps = {
  /** Starts the key stream on the keyboard of `board` that is plugged in. Throws CaptureError with what to do when there is none. */
  startCapture(board: BoardDefinition, hooks: CaptureHooks): Promise<KeyCapture>;
  /** The replay for a layout: runs a document and key events on the board's firmware emulator. */
  replay(app: App, view: LayoutView, boardRevision: string, hooks: { log: LogSink; onProgress?: (line: string) => void; signal?: AbortSignal }): Replay;
};

/** Reads the keyboard that is plugged in: raw HID for the Moonlander, the keyloom module's serial port for ZMK boards. */
async function startRealCapture(board: BoardDefinition, hooks: CaptureHooks): Promise<KeyCapture> {
  if (board.firmware === "kanata") {
    throw new UsageError(`${board.name} can't be recorded: its software remapper exposes no stream of physical key events. S52 looks at a later route.`);
  }
  try {
    if (board.firmware === "qmk") {
      const hid = await defaultHidTransport();
      return await startQmkCapture(hid, await findQmkStreamDevice(hid), hooks);
    }
    const serial = await defaultSerialTransport();
    return await startZmkCapture(serial, (await findZmkStreamPort(board, serial)).path, hooks);
  } catch (err) {
    if (err instanceof CaptureError) throw new UsageError(err.message);
    throw err;
  }
}

/** Quiet time before a recording is replayed: a real keyboard has been running for a while, and QMK reads a timer of zero as "not started". */
const REPLAY_LEAD_MS = 100;

const emulatorReplay: LabDeps["replay"] = (app, view, boardRevision, hooks) => async (doc: Layout, events) =>
  emulateEvents(app, { ...view, document: doc }, events, { boardRevision, log: hooks.log, leadMs: REPLAY_LEAD_MS, cache: false, ...(hooks.onProgress ? { onProgress: hooks.onProgress } : {}), ...(hooks.signal ? { signal: hooks.signal } : {}) });

export const realLabDeps = (): LabDeps => ({ startCapture: startRealCapture, replay: emulatorReplay });

// --- passages ---------------------------------------------------------------------------------

export type PassageView = { id: string; title: string; why: string; text: string };

export function labPassages(app: App, ref: string): PassageView[] {
  const view = getLayout(app, ref);
  return builtinPassages(view.document, view.board.definition).map((p) => ({ id: p.id, title: p.title, why: p.why, text: passageLines(p) }));
}

/** The passage a session will ask for: a built-in by ID, the person's own text, or the starter. */
export function choosePassage(view: LayoutView, opts: { passageId?: string; text?: string }): Passage {
  if (opts.text !== undefined) {
    const passage = customPassage(opts.text);
    if (passage.steps.every((s) => s.kind === "text" && s.text === "")) throw new UsageError("that text has nothing the lab can ask for; use letters, digits, spaces and basic punctuation");
    return passage;
  }
  const all = builtinPassages(view.document, view.board.definition);
  const found = all.find((p) => p.id === (opts.passageId ?? "starter"));
  if (!found) throw new UsageError(`no passage "${opts.passageId}"; use one of: ${all.map((p) => p.id).join(", ")}`);
  return found;
}

// --- recording --------------------------------------------------------------------------------

export type RecordingInProgress = {
  view: LayoutView;
  passage: Passage;
  capture: KeyCapture;
  startedAt: number;
};

/** Starts listening to the keyboard. Nothing is saved until `endRecording`; the notice that this is happening is the caller's to show. */
export async function beginRecording(
  app: App, ref: string, deps: LabDeps, opts: { passageId?: string; text?: string; hooks?: CaptureHooks; announce?: (passage: Passage) => void } = {},
): Promise<RecordingInProgress> {
  const view = getLayout(app, ref);
  const passage = choosePassage(view, opts);
  // After the checks that can refuse and before the first key is heard: the person is told before anything is recorded.
  opts.announce?.(passage);
  const capture = await deps.startCapture(view.board.definition, opts.hooks ?? {});
  return { view, passage, capture, startedAt: Date.now() };
}

/** Ends the stream, saves the session with what was typed, and returns it. A recording with no key presses is not saved. */
export async function endRecording(app: App, rec: RecordingInProgress, typedText: string): Promise<{ session: TypingSessionSummary; trace: CapturedTrace }> {
  const trace = await rec.capture.finish();
  if (trace.events.length === 0) throw new UsageError("no key presses were recorded, so nothing was saved");
  const board = rec.view.board.definition;
  const saved = insertTypingSession(app.db, {
    layoutId: rec.view.layout.id, revisionId: rec.view.revision.id, boardId: board.id, firmware: board.firmware === "zmk" ? "zmk" : "qmk",
    startedAt: rec.startedAt, endedAt: Date.now(), passage: rec.passage, typedText, events: trace.events, warnings: trace.warnings,
  });
  return { session: summaryOf(saved), trace };
}

function summaryOf(row: TypingSessionRow): TypingSessionSummary {
  const { passage: _passage, typedText: _typed, events, analysis, ...rest } = row;
  return { ...rest, eventCount: events.length, analysed: analysis !== null };
}

export function sessions(app: App, ref?: string): TypingSessionSummary[] {
  const layoutId = ref === undefined ? undefined : getLayout(app, ref).layout.id;
  return listTypingSessions(app.db, layoutId === undefined ? {} : { layoutId });
}

/** Deletes a session with its trace, its typed text and its analysis. The proposals made from it stay, as any change set does. */
export async function deleteSession(app: App, id: string): Promise<void> {
  if (!deleteTypingSession(app.db, id)) throw new NotFoundError(`no typing session "${id}"`);
  // A failed analysis keeps its log, and the log holds what the firmware did with the keys.
  await rm(labLogPath(app, id), { force: true });
}

const labLogPath = (app: App, id: string): string => join(app.dataDir, "logs", `lab-${id}.log`);

/** An analysis in the shape this version reads; an older or newer one is treated as not made, so it is redone and never misread. */
const hasAnalysis = (row: TypingSessionRow): boolean => (row.analysis as { schemaVersion?: number } | null)?.schemaVersion === 1;

function sessionRow(app: App, id: string): TypingSessionRow {
  const row = findTypingSession(app.db, id);
  if (!row) throw new NotFoundError(`no typing session "${id}"`);
  return row;
}

// --- analysing --------------------------------------------------------------------------------

/** An analysis as it is stored: the engine's result, and the change sets made from its suggestions. */
export type StoredAnalysis = Analysis & { proposals: Array<{ candidateId: string; changeSetId: string | null; problem?: string }> };

export type AnalyseOptions = {
  /** Store each clear suggestion as a proposed change set (default). */
  propose?: boolean;
  maxRuns?: number;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
};

function exampleText(layout: Layout, e: Example): string {
  const a = keyName(layout, e.position);
  const b = e.nextPosition === undefined ? undefined : keyName(layout, e.nextPosition);
  const overlap = e.facts.overlapMs > 0 && b !== undefined ? `, ${e.facts.overlapMs} ms of it after ${b} went down` : "";
  return `${b === undefined ? a : `${a} then ${b}`}: ${a} was down ${e.facts.heldMs} ms${overlap}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function proposalFor(layout: Layout, s: Suggestion, recordedOn: number) {
  const e = s.evidence;
  const date = new Date(recordedOn).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  const gained = `${e.removed} of ${e.before} ${plural(e.before, "misfire", "misfires")} gone`;
  const cost = e.introduced === 0 ? "none new" : `${e.introduced} new`;
  // A scripted or very regular typist repeats the same misfire word for word; saying it twice adds nothing.
  const examples = [...new Set(e.examples.map((x) => exampleText(layout, x)))].slice(0, 2);
  return {
    title: s.candidate.title,
    explanation: `${s.candidate.title}. Replaying your ${date} recording with this change: ${gained}, ${cost}.${examples.length ? ` For example ${examples.join("; ")}.` : ""}`,
    tradeoffs: {
      gains: [`${gained} on your own typing`],
      costs: e.introduced === 0 ? [] : [`${e.introduced} new ${plural(e.introduced, "misfire", "misfires")} on your own typing${e.newProblems[0] ? `, such as ${exampleText(layout, e.newProblems[0])}` : ""}`],
    },
    decisionDraft: {
      goal: "Stop my tap-hold keys misfiring while I type",
      choice: s.candidate.title.slice(0, 300),
      reason: `Tried on my own recording from ${date}: ${gained}, ${cost}.`.slice(0, 500),
      scope: { apps: [], habits: ["Typing with tap-hold keys"] },
      sourceMessageIds: [] as string[],
    },
  };
}

/**
 * Replays a session through the layout as it was when it was recorded, tells it per finger, tries other settings on it, and keeps the
 * result. Each clear suggestion becomes a proposed change set against the head, replacing any this session made before.
 */
export async function analyseSession(app: App, id: string, deps: LabDeps, opts: AnalyseOptions = {}): Promise<{ session: TypingSessionSummary; analysis: StoredAnalysis }> {
  const row = sessionRow(app, id);
  const view = getLayout(app, row.layoutId, row.revisionId);
  const board = view.board.definition;
  const boardRevision = row.boardRevision ?? (board.revisions[0] as { id: string }).id;
  // The firmware's output is a copy of what was typed, so the log is kept only when a run fails and it is needed to see why.
  const logPath = labLogPath(app, row.id);
  const log = new LogSink(logPath);
  let finished = false;
  try {
    const analysis = await analyse({
      board, layout: view.document, passage: row.passage, events: row.events, typedText: row.typedText,
      replay: deps.replay(app, view, boardRevision, { log, ...(opts.onProgress ? { onProgress: opts.onProgress } : {}), ...(opts.signal ? { signal: opts.signal } : {}) }),
      ...(opts.maxRuns === undefined ? {} : { maxRuns: opts.maxRuns }),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
    const stored: StoredAnalysis = { ...analysis, proposals: [] };

    // One transaction for the whole write-up, so two analyses of one session racing cannot both leave their proposals behind: the loser
    // sees the winner's and rejects them. The session is read again inside it, because it may have been deleted while Docker ran.
    transact(app.db, () => {
      const previous = (sessionRow(app, id).analysis as StoredAnalysis | null)?.proposals ?? [];
      for (const p of previous) {
        if (p.changeSetId === null) continue;
        try {
          rejectChange(app, p.changeSetId);
        } catch {
          // Applied, rejected or superseded already: it is not this analysis's to touch.
        }
      }
      const head = getLayout(app, row.layoutId);
      if (head.revision.id !== row.revisionId && analysis.suggestions.length > 0) {
        stored.notes.push("the layout has changed since this was recorded; suggestions were tried on the layout as it was, and are checked against the current one when proposed");
      }
      for (const s of analysis.suggestions) {
        if (opts.propose === false) {
          stored.proposals.push({ candidateId: s.candidate.id, changeSetId: null });
          continue;
        }
        try {
          const cs = proposeChange(app, row.layoutId, { ops: s.ops, source: "agent", ...proposalFor(view.document, s, row.startedAt) });
          stored.proposals.push({ candidateId: s.candidate.id, changeSetId: cs.id });
        } catch (err) {
          if (!(err instanceof ValidationFailedError)) throw err;
          stored.proposals.push({ candidateId: s.candidate.id, changeSetId: null, problem: err.message });
          stored.notes.push(`${s.candidate.title} could not be proposed on the current layout: ${err.message}`);
        }
      }
      saveAnalysis(app.db, row.id, stored);
    });
    finished = true;
    return { session: summaryOf({ ...row, analysis: stored, analysedAt: Date.now() }), analysis: stored };
  } finally {
    log.close();
    if (finished) await rm(logPath, { force: true });
  }
}

/** The analysis stored for a session, or a message saying to run one. */
export function sessionAnalysis(app: App, id: string): { session: TypingSessionSummary; analysis: StoredAnalysis } {
  const row = sessionRow(app, id);
  if (!hasAnalysis(row)) throw new UsageError(`session ${id} has not been analysed; run: keyloom lab analyse ${id}`);
  return { session: summaryOf(row), analysis: row.analysis as StoredAnalysis };
}

/** The recorded passage and what was typed, for `lab show`. Local only. */
export function sessionContent(app: App, id: string): { passage: Passage; typedText: string; seconds: number } {
  const row = sessionRow(app, id);
  return { passage: row.passage, typedText: row.typedText, seconds: (prepareEvents(row.events).at(-1)?.at ?? 0) / 1000 };
}

// --- the agent --------------------------------------------------------------------------------

/** What the agent may know: counts, per-finger numbers, sentences, suggestions and key-name examples (D-280). */
export function typingFindings(app: App, layoutId: string): TypingFindings {
  const all = listTypingSessions(app.db, { layoutId });
  const rows = all.filter((s) => s.analysed).map((s) => sessionRow(app, s.id)).filter(hasAnalysis);
  const row = rows[0];
  if (!row) return { sessions: all.length, analysed: 0 };
  const analysed = rows;
  const stored = row.analysis as StoredAnalysis;
  const view = getLayout(app, layoutId, row.revisionId);
  const byCandidate = new Map(stored.proposals.map((p) => [p.candidateId, p.changeSetId]));
  return {
    sessions: all.length,
    analysed: analysed.length,
    latest: {
      sessionId: row.id, recordedAt: row.startedAt, seconds: stored.durationMs / 1000, presses: stored.presses, counts: stored.counts,
      findings: stored.findings.slice(0, 8).map((f) => ({ kind: f.kind, sentence: f.sentence })),
      fingers: stored.stats.fingers.map((f) => ({ finger: f.finger, keys: f.attempts, errors: f.errors, medianMsBetweenKeys: f.interKey.median })),
      suggestions: stored.suggestions.map((s) => ({
        title: s.candidate.title, changeSetId: byCandidate.get(s.candidate.id) ?? null, before: s.evidence.before, after: s.evidence.after,
        removed: s.evidence.removed, introduced: s.evidence.introduced,
        examples: s.evidence.examples.map((e) => ({
          kind: e.kind, keys: [keyName(view.document, e.position), ...(e.nextPosition === undefined ? [] : [keyName(view.document, e.nextPosition)])], heldMs: e.facts.heldMs, overlapMs: e.facts.overlapMs,
        })),
      })),
      notes: stored.notes,
    },
  };
}

// --- the screens --------------------------------------------------------------------------------

/** Why a board can't be recorded, in words; null when it can (24-typing-lab.md, capturing what the hands do). */
export function cannotRecord(board: BoardDefinition): string | null {
  return board.firmware === "kanata" ? `The lab can't listen to the ${board.name}: it has no stream of physical key presses yet.` : null;
}

const fingerWords = (finger: string) => finger.replaceAll("-", " ");

/** The sentence that leads the fingers block (D-314): the slowest finger and the one with most errors, or that they are even. */
export function fingersLead(rows: readonly { finger: string; keys: number; errors: number; medianMs: number }[]): string {
  const measured = rows.filter((r) => r.keys >= 5);
  if (measured.length === 0) return "Not enough typing yet to tell your fingers apart.";
  const slow = [...measured].filter((r) => r.medianMs > 0).sort((a, b) => b.medianMs - a.medianMs)[0];
  // "Most errors" is a count, as the engine's errors-by-finger finding counts them; the rate only breaks a tie.
  const rate = (r: { keys: number; errors: number }) => r.errors / r.keys;
  const err = [...measured].filter((r) => r.errors > 0).sort((a, b) => b.errors - a.errors || rate(b) - rate(a))[0];
  const parts: string[] = [];
  if (slow !== undefined) parts.push(`Your ${fingerWords(slow.finger)} is your slowest finger`);
  if (err === undefined) parts.push("no finger made an error");
  else if (err.finger === slow?.finger) parts[0] = `Your ${fingerWords(err.finger)} is your slowest finger and makes the most errors`;
  else parts.push(`most errors come from your ${fingerWords(err.finger)}`);
  const text = parts.join(", and ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** The read-out as the screen takes it; src/api/lab.ts checks the same shape on the wire. */
export type LabReadout = {
  presses: number; durationMs: number; passageId: string; counts: StoredAnalysis["counts"]; fingersLead: string;
  fingers: Array<{ finger: string; hand: "left" | "right"; keys: number; errors: number; typos: number; misfires: number; medianMs: number }>;
  findings: Array<{ id: string; kind: string; sentence: string; positions: number[] }>;
  suggestions: Array<{
    title: string; before: number; after: number; removed: number; introduced: number;
    example: { position: number; held: string; next: string | null; heldMs: number; overlapMs: number; termMs: number | null } | null;
    proposal: ReturnType<typeof toCard> | null;
  }>;
  notes: string[];
};

/** A session's read-out for the screen: counts, sentences, per-finger rows and positions to mark, with each suggestion's proposal card. */
export function labReadout(app: App, id: string): { session: TypingSessionSummary; readout: LabReadout | null } {
  const row = sessionRow(app, id);
  const session = summaryOf(row);
  if (!hasAnalysis(row)) return { session, readout: null };
  const stored = row.analysis as StoredAnalysis;
  const view = getLayout(app, row.layoutId, row.revisionId);
  const layout = view.document;
  const boardFingers = view.board.definition.fingers;
  const fingers = stored.stats.fingers.map((f) => ({
    finger: f.finger, hand: f.hand, keys: f.attempts, errors: f.errors, typos: f.typos ?? 0, misfires: f.misfires ?? 0, medianMs: f.interKey.median,
  }));
  const positionsOf = (f: StoredAnalysis["findings"][number]): number[] => {
    if (typeof f.data.position === "number") {
      const next = stored.differences.find((d) => d.position === f.data.position && d.facts?.nextPosition !== undefined)?.facts?.nextPosition;
      return next === undefined ? [f.data.position] : [f.data.position, next];
    }
    if (typeof f.data.finger === "string") {
      const finger = f.data.finger;
      return [...new Set(stored.differences.flatMap((d) => (d.position !== undefined && boardFingers[String(d.position)] === finger ? [d.position] : [])))];
    }
    return [];
  };
  const byCandidate = new Map(stored.proposals.map((p) => [p.candidateId, p.changeSetId]));
  return {
    session,
    readout: {
      presses: stored.presses, durationMs: stored.durationMs, passageId: row.passageId, counts: stored.counts,
      fingersLead: fingersLead(fingers), fingers,
      findings: stored.findings.slice(0, 6).map((f) => ({ id: f.id, kind: f.kind, sentence: f.sentence, positions: positionsOf(f) })),
      suggestions: stored.suggestions.map((s) => {
        const e = s.evidence.examples[0];
        const changeSetId = byCandidate.get(s.candidate.id) ?? null;
        const cs = changeSetId === null ? undefined : findChangeSet(app.db, changeSetId);
        const binding = e === undefined ? undefined : layout.layers[0]?.bindings[e.position];
        return {
          title: s.candidate.title, before: s.evidence.before, after: s.evidence.after, removed: s.evidence.removed, introduced: s.evidence.introduced,
          example: e === undefined ? null : {
            position: e.position, held: keyName(layout, e.position), next: e.nextPosition === undefined ? null : keyName(layout, e.nextPosition), heldMs: e.facts.heldMs, overlapMs: e.facts.overlapMs,
            termMs: binding?.kind === "holdTap" ? (tappingTermOf(layout, binding.profileId) ?? null) : null,
          },
          proposal: cs === undefined ? null : toCard(cs),
        };
      }),
      notes: stored.notes,
    },
  };
}
