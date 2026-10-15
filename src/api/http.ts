// Wire format shared by the server and the browser client. The layout, board and
// geometry schemas are imported from their owning modules, not redefined here.
import { z } from "zod";
import { BoardDefinitionSchema, GeometrySchema } from "../boards/schema.ts";
import { ChangeOpSchema } from "../layout/change.ts";
import { LayoutSchema } from "../layout/schema.ts";
import { ValidationResultSchema } from "../validation/result.ts";

export const LayoutSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  boardId: z.string().min(1),
  // When the layout was first saved (its import, today) and the revision the viewer is showing.
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  revisionId: z.string().min(1),
});
export type LayoutSummary = z.infer<typeof LayoutSummarySchema>;

export const LayoutListResponseSchema = z.object({
  layouts: z.array(LayoutSummarySchema),
});

// The revision the detail shows. `undoable` is false for the import revision, which has no parent.
export const RevisionInfoSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  origin: z.enum(["import", "editor", "agent", "undo"]),
  summary: z.string(),
  createdAt: z.number().finite(),
  undoable: z.boolean(),
});
export type RevisionInfo = z.infer<typeof RevisionInfoSchema>;

export const LayoutDetailSchema = z.object({
  revision: RevisionInfoSchema,
  document: LayoutSchema,
  board: BoardDefinitionSchema,
  geometry: GeometrySchema,
});
export type LayoutDetail = z.infer<typeof LayoutDetailSchema>;

// Editing, building and flashing (rung 2). Every route below takes and returns JSON, needs the
// session token like the reads, and reports failure with ApiErrorBody.
//   POST /api/layouts/:ref/check        CheckRequest  -> CheckResponse
//   POST /api/layouts/:ref/apply        ApplyRequest  -> ApplyResponse     (409 on stale_base or invalid ops)
//   POST /api/layouts/:ref/undo         UndoRequest   -> UndoResponse      (409 when the head moved)
//   POST /api/layouts/:ref/builds       BuildRequest  -> Build             (202; poll GET /api/builds/:id)
//   GET  /api/builds/:id                              -> Build
//   POST /api/builds/:id/flashes        {}            -> Flash             (202; poll GET /api/flashes/:id)
//   GET  /api/flashes/:id                             -> Flash

export const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  // Present when ops failed validation, so the editor can point at the slots.
  validation: ValidationResultSchema.optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const CheckRequestSchema = z.object({
  baseRevisionId: z.string().min(1),
  ops: z.array(ChangeOpSchema).min(1),
});
export type CheckRequest = z.infer<typeof CheckRequestSchema>;

export const CheckResponseSchema = z.object({ validation: ValidationResultSchema });
export type CheckResponse = z.infer<typeof CheckResponseSchema>;

export const ApplyRequestSchema = CheckRequestSchema.extend({
  // One line for the revision history, such as "Layer 2, key 31: Left Alt".
  summary: z.string().min(1).max(200),
});
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;

export const ApplyResponseSchema = z.object({
  revisionId: z.string().min(1),
  changeSetId: z.string().min(1),
  validation: ValidationResultSchema,
});
export type ApplyResponse = z.infer<typeof ApplyResponseSchema>;

// Undo names the head it expects to undo, so a stale tab can't undo someone else's change.
export const UndoRequestSchema = z.object({ revisionId: z.string().min(1) });
export type UndoRequest = z.infer<typeof UndoRequestSchema>;

export const UndoResponseSchema = z.object({ revisionId: z.string().min(1) });
export type UndoResponse = z.infer<typeof UndoResponseSchema>;

export const BuildRequestSchema = z.object({
  revisionId: z.string().min(1),
  // The board revision to build for, such as "revb". Omitted, keyloom detects the connected keyboard
  // and answers 400 `usage` when none is connected, so the editor can ask.
  boardRevision: z.string().min(1).optional(),
});
export type BuildRequest = z.infer<typeof BuildRequestSchema>;

export const BuildSchema = z.object({
  id: z.string().min(1),
  revisionId: z.string().min(1),
  status: z.enum(["running", "succeeded", "failed"]),
  error: z.string().nullable(),
  startedAt: z.number().finite(),
  finishedAt: z.number().finite().nullable(),
  // The last lines of the build log, oldest first, for a progress view.
  logTail: z.array(z.string()),
});
export type Build = z.infer<typeof BuildSchema>;

export const FlashSchema = z.object({
  id: z.string().min(1),
  buildId: z.string().min(1),
  status: z.enum(["waiting_for_bootloader", "writing", "succeeded", "failed"]),
  error: z.string().nullable(),
  startedAt: z.number().finite(),
  finishedAt: z.number().finite().nullable(),
  // What the person must do now, such as "Press the reset button on the Moonlander".
  instruction: z.string().nullable(),
  logTail: z.array(z.string()),
});
export type Flash = z.infer<typeof FlashSchema>;
