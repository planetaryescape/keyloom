// Repository for the typing lab's sessions (D-280). The trace and the typed text are personal, so this is the only place they are
// written, they are read back only by `lab analyse` and the lab's own screens, and a session can be deleted outright.
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { newId } from "./ids.ts";

const TraceEventSchema = z.object({ at: z.number().min(0), position: z.number().int().min(0), action: z.enum(["press", "release"]), source: z.number().int().optional() });
export type StoredTraceEvent = z.infer<typeof TraceEventSchema>;
const EventsSchema = z.array(TraceEventSchema);

const StepSchema = z.union([z.object({ kind: z.literal("text"), text: z.string() }), z.object({ kind: z.literal("hold"), key: z.string(), then: z.string() })]);
const PassageSchema = z.object({ id: z.string(), title: z.string(), why: z.string(), steps: z.array(StepSchema) });
export type StoredPassage = z.infer<typeof PassageSchema>;

export type TypingSessionRow = {
  id: string;
  layoutId: string;
  revisionId: string;
  boardId: string;
  boardRevision: string | null;
  firmware: "qmk" | "zmk";
  startedAt: number;
  endedAt: number;
  passageId: string;
  passage: StoredPassage;
  typedText: string;
  events: StoredTraceEvent[];
  warnings: string[];
  /** The last analysis as it was saved (src/lab/analyse.ts Analysis), or null before one ran. Opaque here. */
  analysis: unknown;
  analysedAt: number | null;
};

/** A session without its trace and text, for lists. */
export type TypingSessionSummary = Omit<TypingSessionRow, "passage" | "typedText" | "events" | "analysis"> & { eventCount: number; analysed: boolean };

type Db = {
  id: string; layout_id: string; revision_id: string; board_id: string; board_revision: string | null; firmware: "qmk" | "zmk"; started_at: number; ended_at: number;
  passage_id: string; passage: string; typed_text: string; events: string; warnings: string; analysis: string | null; analysed_at: number | null;
};

const toRow = (r: Db): TypingSessionRow => ({
  id: r.id, layoutId: r.layout_id, revisionId: r.revision_id, boardId: r.board_id, boardRevision: r.board_revision, firmware: r.firmware, startedAt: r.started_at,
  endedAt: r.ended_at, passageId: r.passage_id, passage: PassageSchema.parse(JSON.parse(r.passage)), typedText: r.typed_text, events: EventsSchema.parse(JSON.parse(r.events)),
  warnings: z.array(z.string()).parse(JSON.parse(r.warnings)), analysis: r.analysis === null ? null : JSON.parse(r.analysis), analysedAt: r.analysed_at,
});

export const newTypingSessionId = (): string => newId("typ");

export type InsertTypingSession = {
  layoutId: string; revisionId: string; boardId: string; boardRevision?: string; firmware: "qmk" | "zmk"; startedAt: number; endedAt: number;
  passage: StoredPassage; typedText: string; events: StoredTraceEvent[]; warnings: string[];
};

export function insertTypingSession(db: Database, input: InsertTypingSession): TypingSessionRow {
  const id = newTypingSessionId();
  db.query(
    "INSERT INTO typing_sessions (id, layout_id, revision_id, board_id, board_revision, firmware, started_at, ended_at, passage_id, passage, typed_text, events, warnings, analysis, analysed_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
  ).run(
    id, input.layoutId, input.revisionId, input.boardId, input.boardRevision ?? null, input.firmware, input.startedAt, input.endedAt, input.passage.id,
    JSON.stringify(PassageSchema.parse(input.passage)), input.typedText, JSON.stringify(EventsSchema.parse(input.events)), JSON.stringify(input.warnings),
  );
  return findTypingSession(db, id) as TypingSessionRow;
}

export function findTypingSession(db: Database, id: string): TypingSessionRow | undefined {
  const row = db.query("SELECT * FROM typing_sessions WHERE id = ?").get(id) as Db | null;
  return row ? toRow(row) : undefined;
}

/** Sessions, newest first, without their traces. */
export function listTypingSessions(db: Database, opts: { layoutId?: string } = {}): TypingSessionSummary[] {
  const rows = (opts.layoutId === undefined
    ? db.query("SELECT id, layout_id, revision_id, board_id, board_revision, firmware, started_at, ended_at, passage_id, warnings, analysed_at, analysis IS NOT NULL AS analysed, json_array_length(events) AS event_count FROM typing_sessions ORDER BY started_at DESC, id DESC").all()
    : db.query("SELECT id, layout_id, revision_id, board_id, board_revision, firmware, started_at, ended_at, passage_id, warnings, analysed_at, analysis IS NOT NULL AS analysed, json_array_length(events) AS event_count FROM typing_sessions WHERE layout_id = ? ORDER BY started_at DESC, id DESC").all(opts.layoutId)) as Array<
    Omit<Db, "passage" | "typed_text" | "events" | "analysis"> & { analysed: number; event_count: number }
  >;
  return rows.map((r) => ({
    id: r.id, layoutId: r.layout_id, revisionId: r.revision_id, boardId: r.board_id, boardRevision: r.board_revision, firmware: r.firmware, startedAt: r.started_at,
    endedAt: r.ended_at, passageId: r.passage_id, warnings: z.array(z.string()).parse(JSON.parse(r.warnings)), analysedAt: r.analysed_at, eventCount: r.event_count, analysed: r.analysed === 1,
  }));
}

export function saveAnalysis(db: Database, id: string, analysis: unknown, now = Date.now()): void {
  const changed = db.query("UPDATE typing_sessions SET analysis = ?, analysed_at = ? WHERE id = ?").run(JSON.stringify(analysis), now, id).changes;
  if (changed === 0) throw new Error(`there is no typing session ${id}`);
}

/** Removes the session with its trace, its typed text and its analysis. True when there was one. */
export function deleteTypingSession(db: Database, id: string): boolean {
  return db.query("DELETE FROM typing_sessions WHERE id = ?").run(id).changes > 0;
}
