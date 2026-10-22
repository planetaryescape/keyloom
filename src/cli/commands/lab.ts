// keyloom lab (24-typing-lab.md): record the connected keyboard while the person types a passage, then say what went wrong and what
// would fix it. Thin: each command calls one use case in src/app. The terminal (raw keys in, the passage and the typed text out) is
// here, because it is what a command line does; tests pass a scripted one.
import type { Command } from "commander";
import {
  type App, type LabDeps, type StoredAnalysis, UsageError, incompleteRecording, analyseSession, beginRecording, deleteSession, endRecording, labPassages, labSessions, realLabDeps, sessionAnalysis, sessionContent,
} from "../../app/index.ts";
import { type Io, type Format, columns, print } from "../output.ts";
import { progressLine, untilInterrupted } from "./firmware.ts";

/** How the person types in the terminal. `typing` resolves with the text when they end the session; real runs read raw keys. */
export type LabTerminal = {
  isInteractive: boolean;
  typing(onText: (text: string) => void, ended: Promise<unknown>): Promise<string>;
};

export type LabCliDeps = { lab?: LabDeps; terminal?: LabTerminal };

/** Raw keys from standard input until Ctrl-C (or `ended`), with Backspace editing the text. */
export function stdinTerminal(): LabTerminal {
  return {
    isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    typing(onText, ended) {
      return new Promise<string>((resolve) => {
        let text = "";
        const stdin = process.stdin;
        const finish = () => {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          resolve(text);
        };
        const onData = (chunk: Buffer) => {
          for (const ch of chunk.toString("utf8")) {
            if (ch === "\x03" || ch === "\x04") return finish();
            if (ch === "\x7f" || ch === "\b") text = [...text].slice(0, -1).join("");
            else if (ch === "\r") text += "\n";
            else if (ch >= " " || ch === "\t") text += ch;
          }
          onText(text);
        };
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on("data", onData);
        void ended.then(finish);
      });
    },
  };
}

export type LabCommandDeps = { io: Io; format: () => Format; quiet: () => boolean; withApp: <T>(fn: (app: App) => Promise<T> | T) => Promise<T>; cli?: LabCliDeps };

const NOTICE = [
  "keyloom is recording this keyboard's key presses (which key, and when) and what you type here, until you press Ctrl-C.",
  "They stay on this computer, in keyloom's database. Nothing is sent anywhere. Don't type passwords. Delete the recording any time with: keyloom lab delete <session>",
].join("\n");

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && [...line].length + 1 + [...word].length > width) {
      lines.push(line);
      line = word;
    } else line = line === "" ? word : `${line} ${word}`;
  }
  return line === "" ? lines : [...lines, line];
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;

/** The analysis as a person reads it: the findings first, the proof under them. Counts and sentences, never the recording. */
export function analysisText(id: string, a: StoredAnalysis): string {
  const c = a.counts;
  const lines = [
    `${id}: ${a.presses} key presses in ${seconds(a.durationMs)}.`,
    `Holds where a tap was meant: ${c.misfireHold}. Taps where a hold was meant: ${c.misfireTap}. Typos: ${c.typo}. Missed keys: ${c.missed}. Doubled keys: ${c.double}.`,
    "",
  ];
  if (a.findings.length === 0) lines.push("Nothing stood out in this recording.");
  else lines.push("What stood out:", ...a.findings.slice(0, 5).map((f) => `  ${f.sentence}`));
  if (a.stats.fingers.length > 0) {
    lines.push("", "Per finger:", columns([["FINGER", "KEYS", "ERRORS", "BETWEEN KEYS"], ...a.stats.fingers.map((f) => [f.finger.replaceAll("-", " "), String(f.attempts), String(f.errors), f.interKey.n === 0 ? "-" : `${Math.round(f.interKey.median)} ms`])]).replace(/^/gm, "  "));
  }
  if (a.stats.sameFinger.length > 0) {
    lines.push("", "Same-finger transitions:", columns([["FINGER", "KEYS", "BETWEEN KEYS"], ...a.stats.sameFinger.map((r) => [r.finger.replaceAll("-", " "), `${r.from}→${r.to}`, `${Math.round(r.interKey.median)} ms`])]).replace(/^/gm, "  "));
  }
  if (a.stats.rolls.length > 0) {
    lines.push("", "Rolls:", columns([["FROM", "TO", "OVERLAP", "COUNT"], ...a.stats.rolls.map((r) => [r.fromFinger.replaceAll("-", " "), r.toFinger.replaceAll("-", " "), `${Math.round(r.overlap.median)} ms`, `${r.rolls}/${r.n}`])]).replace(/^/gm, "  "));
  }
  if (a.stats.holds.length > 0) {
    lines.push("", "Holds:", columns([["POSITION", "TAPS MEDIAN", "HOLDS MEDIAN", "TERM", "NEAR TERM"], ...a.stats.holds.map((h) => [String(h.position), `${Math.round(h.taps.median)} ms`, `${Math.round(h.holds.median)} ms`, h.termMs !== undefined ? `${h.termMs} ms` : "-", String(h.nearTerm)])]).replace(/^/gm, "  "));
  }
  if (a.suggestions.length > 0) {
    lines.push("", "Tried on this recording:");
    for (const s of a.suggestions) {
      const e = s.evidence;
      const made = a.proposals.find((p) => p.candidateId === s.candidate.id)?.changeSetId;
      lines.push(`  ${s.candidate.title}`, `    ${e.removed} of ${e.before} misfires gone, ${e.introduced === 0 ? "none new" : `${e.introduced} new`}${made ? `. Proposed as ${made}; review it with: keyloom change show ${made}` : ""}`);
    }
  }
  if (a.fidelity) {
    lines.push("", `Replay check: your keyboard typed ${a.fidelity.typedByKeyboard} characters here and the replay typed ${a.fidelity.typedByReplay}; ${a.fidelity.differing === 0 ? "they match" : `${a.fidelity.differing} differ`}.`);
  }
  for (const n of a.notes) lines.push("", `Note: ${n}.`);
  if (a.coarseSearch) lines.push("", `The search went from big steps to small ones over ${a.emulatorRuns} emulator runs, so a setting between the steps tried may do better.`);
  return lines.join("\n");
}

export function registerLabCommands(program: Command, deps: LabCommandDeps): void {
  const { io, format, quiet, withApp } = deps;
  const lab = deps.cli?.lab ?? realLabDeps();
  const terminal = deps.cli?.terminal ?? stdinTerminal();

  const group = program.command("lab").description("the typing lab: record your typing, find what goes wrong with your timings, and try fixes on the recording before you flash anything");

  group
    .command("passages")
    .description("the passages the lab can ask you to type, built from this layout's own home row")
    .argument("<layout>", "layout ID or name")
    .action(async (ref: string) => {
      const list = await withApp((app) => labPassages(app, ref));
      print(io, format(), {
        json: { passages: list },
        ids: list.map((p) => p.id),
        table: list.map((p) => `${p.id}: ${p.title}. ${p.why}`).join("\n"),
        rows: list.map((p) => ({ schema_version: 1, ...p })),
      });
    });

  group
    .command("start")
    .description("record the connected keyboard while you type a passage; Ctrl-C ends it. Needs a keyboard running a keyloom build")
    .argument("<layout>", "layout ID or name")
    .option("--passage <id>", "a passage from `keyloom lab passages` (default: starter)")
    .option("--text <text>", "type your own text instead")
    .action(async (ref: string, opts: { passage?: string; text?: string }) => {
      if (!terminal.isInteractive) throw new UsageError("keyloom lab start needs a terminal: it shows you the passage and reads what you type");
      const result = await withApp(async (app) => {
        const rec = await beginRecording(app, ref, lab, {
          ...(opts.passage ? { passageId: opts.passage } : {}), ...(opts.text ? { text: opts.text } : {}),
          // In JSON formats stderr carries only an error document, so the notice joins the passage display on stdout, where the
          // one JSON document is the result printed at the end.
          announce: () => (format() === "json" || format() === "jsonl" ? io.out(`${NOTICE}\n\n`) : io.err(`${NOTICE}\n\n`)),
        });
        try {
          const width = Math.min(100, Math.max(40, (process.stdout.columns ?? 80) - 2));
          const passage = rec.passage.steps.map((s) => (s.kind === "text" ? s.text : ` [hold ${s.key}, press ${s.then}] `)).join("").replace(/ {2,}/g, " ").trim();
          io.out(`${rec.passage.title}: ${rec.passage.why}\n\n${wrap(passage, width).join("\n")}\n\n`);
          io.out("typed:\n");
          const show = (text: string) => {
            const tail = [...text.replaceAll("\n", "⏎")].slice(-(width - 2)).join("");
            io.out(`\r\x1b[K${tail}`);
          };
          const typed = await terminal.typing(show, rec.capture.ended);
          io.out("\n");
          return await endRecording(app, rec, typed);
        } catch (err) {
          // Whatever went wrong, the keyboard must stop streaming and nothing half-recorded is kept.
          await rec.capture.finish().catch(() => undefined);
          throw err;
        }
      });
      const s = result.session;
      for (const w of result.trace.warnings) io.err(`warning: ${w}\n`);
      print(io, format(), {
        json: { session_id: s.id, layout_id: s.layoutId, revision_id: s.revisionId, board_id: s.boardId, key_events: s.eventCount, started_at: s.startedAt, ended_at: s.endedAt, ended_by: result.trace.endedBy, warnings: result.trace.warnings },
        table: quiet() ? s.id : incompleteRecording(result.trace.warnings)
          ? `${s.id}\nRecording incomplete; start a new recording with: keyloom lab start ${ref}`
          : `${s.id}\nrecorded ${s.eventCount} key events in ${seconds(s.endedAt - s.startedAt)}${result.trace.endedBy === "host" ? "" : ` (the keyboard ended it: ${result.trace.endedBy})`}.\nSee what it shows: keyloom lab analyse ${s.id}`,
        ids: [s.id],
      });
    });

  group
    .command("analyse")
    .description("replay a session through the layout's real firmware logic, say what went wrong per finger, and try other settings on it; suggestions become proposed change sets")
    .argument("<session>", "session ID")
    .option("--no-propose", "show suggestions without storing them as change sets")
    .option("--max-runs <n>", "most emulator runs the settings search may use (default 12)")
    .option("--show", "print the stored analysis again without running it")
    .action(async (id: string, opts: { propose: boolean; maxRuns?: string; show?: boolean }) => {
      const maxRuns = opts.maxRuns === undefined ? undefined : Number(opts.maxRuns);
      if (maxRuns !== undefined && !(Number.isInteger(maxRuns) && maxRuns >= 1 && maxRuns <= 60)) throw new UsageError(`--max-runs takes a whole number from 1 to 60, not "${opts.maxRuns}"`);
      const progress = progressLine(io);
      try {
        const r = await untilInterrupted((signal) =>
          withApp((app) =>
            opts.show
              ? sessionAnalysis(app, id)
              : analyseSession(app, id, lab, { propose: opts.propose, ...(maxRuns === undefined ? {} : { maxRuns }), onProgress: progress.write, signal }),
          ),
        );
        progress.end();
        const a = r.analysis;
        print(io, format(), {
          json: {
            session_id: r.session.id, presses: a.presses, duration_ms: a.durationMs, counts: a.counts, findings: a.findings, fingers: a.stats.fingers,
            same_finger: a.stats.sameFinger, rolls: a.stats.rolls, holds: a.stats.holds,
            suggestions: a.suggestions.map((s) => ({ title: s.candidate.title, evidence: s.evidence, ops: s.ops, change_set_id: a.proposals.find((p) => p.candidateId === s.candidate.id)?.changeSetId ?? null })),
            emulator_runs: a.emulatorRuns, coarse_search: a.coarseSearch, notes: a.notes,
          },
          table: quiet() ? a.findings.map((f) => f.sentence).join("\n") : analysisText(r.session.id, a),
          ids: a.proposals.flatMap((p) => (p.changeSetId ? [p.changeSetId] : [])),
        });
      } finally {
        progress.end();
      }
    });

  group
    .command("show")
    .description("show what you typed during a recorded session and its prompt passage (local only)")
    .argument("<session>", "session ID")
    .action(async (id: string) => {
      const content = await withApp((app) => sessionContent(app, id));
      const passageText = content.passage.steps.map((s) => (s.kind === "text" ? s.text : `[hold ${s.key}, press ${s.then}]`)).join("");
      print(io, format(), {
        json: {
          session_id: id,
          passage_id: content.passage.id,
          passage_title: content.passage.title,
          passage_text: passageText,
          typed_text: content.typedText,
          seconds: content.seconds,
        },
        table: quiet()
          ? content.typedText
          : `Session: ${id} (${content.seconds.toFixed(1)} s)\nPassage: ${content.passage.title}\n${passageText}\n\nTyped:\n${content.typedText}`,
        ids: [id],
      });
    });

  group
    .command("sessions")
    .description("list recorded sessions, newest first")
    .argument("[layout]", "only this layout's")
    .action(async (ref?: string) => {
      const list = await withApp((app) => labSessions(app, ref));
      print(io, format(), {
        json: { sessions: list.map((s) => ({ session_id: s.id, layout_id: s.layoutId, revision_id: s.revisionId, board_id: s.boardId, passage: s.passageId, key_events: s.eventCount, started_at: s.startedAt, ended_at: s.endedAt, analysed: s.analysed, incomplete: incompleteRecording(s.warnings), warnings: s.warnings })) },
        ids: list.map((s) => s.id),
        table: list.length === 0 ? "no sessions yet; record one with: keyloom lab start <layout>" : columns([["ID", "WHEN", "PASSAGE", "KEY EVENTS", "RECORDING", "ANALYSED"], ...list.map((s) => [s.id, new Date(s.startedAt).toISOString(), s.passageId, String(s.eventCount), incompleteRecording(s.warnings) ? "incomplete" : "recorded", s.analysed ? "yes" : "no"])]),
        rows: list.map((s) => ({ schema_version: 1, session_id: s.id, layout_id: s.layoutId, started_at: s.startedAt, key_events: s.eventCount, analysed: s.analysed, incomplete: incompleteRecording(s.warnings), warnings: s.warnings })),
      });
    });

  group
    .command("delete")
    .description("delete a session with its recording, what you typed and its analysis (proposals made from it stay until you reject them)")
    .argument("<session>", "session ID")
    .action(async (id: string) => {
      await withApp((app) => deleteSession(app, id));
      print(io, format(), { json: { deleted: id }, table: quiet() ? id : `deleted ${id}, with its recording and what you typed`, ids: [id] });
    });
}
