// The typing lab (rung 22, 24-typing-lab.md, D-314): the routes its screens call.
//   GET  /api/lab/:layout/passages               -> LabPassagesResponse (the passages, and whether this board can be recorded)
//   GET  /api/lab/:layout/sessions               -> LabSessionsResponse (newest first)
//   POST /api/lab/:layout/recording   StartRecordingRequest -> RecordingResponse (201; 400 usage when no keyboard is listening,
//                                                   409 busy when a recording is already running)
//   POST /api/lab/recording/stop      StopRecordingRequest  -> LabSessionResponse (the session saved; 400 usage when no keys were heard)
//   POST /api/lab/recording/cancel    {}                    -> {} (nothing is saved)
//   GET  /api/lab/sessions/:id                    -> LabReadoutResponse (the session and its read-out, or null when not analysed)
//   POST /api/lab/sessions/:id/analyse {}         -> LabReadoutResponse (replays the recording; proposes what it proves)
//   POST /api/lab/sessions/:id/delete  {}         -> {}
// The read-out carries counts, sentences, per-finger rows and positions to mark on caps, never the typed text or the raw trace.
import { z } from "zod";
import { ProposalCardSchema } from "./http.ts";

export const LabPassageSchema = z.object({ id: z.string().min(1), title: z.string().min(1), why: z.string(), text: z.string() });
export const LabPassagesResponseSchema = z.object({
  passages: z.array(LabPassageSchema),
  // False for a board the lab can't listen to (the MacBook through kanata), with why in words.
  canRecord: z.boolean(),
  why: z.string().nullable(),
});
export type LabPassage = z.infer<typeof LabPassageSchema>;
export type LabPassagesResponse = z.infer<typeof LabPassagesResponseSchema>;

export const LabSessionSchema = z.object({
  id: z.string().min(1),
  layoutId: z.string().min(1),
  passageId: z.string(),
  startedAt: z.number().finite(),
  endedAt: z.number().finite(),
  eventCount: z.number().int().nonnegative(),
  analysed: z.boolean(),
  warnings: z.array(z.string()),
});
export type LabSession = z.infer<typeof LabSessionSchema>;
export const LabSessionsResponseSchema = z.object({ sessions: z.array(LabSessionSchema) });
export const LabSessionResponseSchema = z.object({ session: LabSessionSchema });

export const StartRecordingRequestSchema = z.object({ passageId: z.string().min(1).optional(), text: z.string().max(4000).optional() }).strict();
export type StartRecordingRequest = z.infer<typeof StartRecordingRequestSchema>;
export const RecordingResponseSchema = z.object({ recording: z.object({ passage: LabPassageSchema, startedAt: z.number().finite() }) });
export const StopRecordingRequestSchema = z.object({ typedText: z.string().max(40_000) }).strict();

export const FingerReadoutSchema = z.object({
  finger: z.string(),
  hand: z.enum(["left", "right"]),
  keys: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  typos: z.number().int().nonnegative(),
  misfires: z.number().int().nonnegative(),
  /** Median time from the previous key down to this finger's key down; 0 when there was no transition to measure. */
  medianMs: z.number().nonnegative(),
});
export type FingerReadout = z.infer<typeof FingerReadoutSchema>;

export const LabReadoutSchema = z.object({
  presses: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  passageId: z.string(),
  counts: z.object({ misfireHold: z.number(), misfireTap: z.number(), typo: z.number(), missed: z.number(), double: z.number() }),
  /** The sentence that leads the fingers block: the slowest finger and the one with most errors, in words. */
  fingersLead: z.string(),
  fingers: z.array(FingerReadoutSchema),
  findings: z.array(z.object({
    id: z.string(), kind: z.string(), sentence: z.string(),
    /** The keys to mark on the caps for this finding (layer 0 positions). */
    positions: z.array(z.number().int().nonnegative()),
  })),
  suggestions: z.array(z.object({
    title: z.string(),
    before: z.number(), after: z.number(), removed: z.number(), introduced: z.number(),
    /** One misfire it removes, slowed down: the key held, the next key, the times. */
    example: z.object({ held: z.string(), next: z.string().nullable(), heldMs: z.number(), overlapMs: z.number(), termMs: z.number().nullable() }).nullable(),
    proposal: ProposalCardSchema.nullable(),
  })),
  notes: z.array(z.string()),
});
export type LabReadout = z.infer<typeof LabReadoutSchema>;
export const LabReadoutResponseSchema = z.object({ session: LabSessionSchema, readout: LabReadoutSchema.nullable() });
export type LabReadoutResponse = z.infer<typeof LabReadoutResponseSchema>;
