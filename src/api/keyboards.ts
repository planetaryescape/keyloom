// A new keyboard (22, rung 21 part 2): the routes the new-keyboard card calls, in the /api/configs style (D-336). Nothing here writes to a
// device: detect reads USB, preview reads the pinned firmware tree, add stores a board definition, put makes a config with proposals.
//   GET  /api/keyboards/detect[?search=<name>] -> DetectResponse (the keyboards on USB keyloom has no board for, or index entries by name)
//   POST /api/keyboards/preview    PreviewRequest -> PreviewResponse (the board as it would be added, drawn, not stored)
//   POST /api/keyboards/add        AddRequest -> AddResponse (201; 400 usage when the home row or controller is missing or wrong)
//   POST /api/keyboards/put/preview PutRequest -> PutPreviewResponse (what a put would make, and the layout it gives the board; nothing stored)
//   POST /api/keyboards/put        PutRequest -> PutResponse (201: a new config on the board, with the mapping as proposals, none applied)
import { z } from "zod";
import { GeometryKeySchema } from "../boards/schema.ts";
import { LayoutSchema } from "../layout/schema.ts";
import { ConfigSchema } from "./configs.ts";
import { CandidateSchema, DetectedKeyboardSchema } from "./detected-keyboards.ts";

export { CandidateSchema, DetectedKeyboardSchema, type ApiCandidate, type DetectedKeyboard } from "./detected-keyboards.ts";

export const DetectResponseSchema = z.object({ keyboards: z.array(DetectedKeyboardSchema), candidates: z.array(CandidateSchema) });
export type DetectResponse = z.infer<typeof DetectResponseSchema>;

export const PreviewRequestSchema = z.object({
  candidate: z.string().min(1),
  homeRow: z.number().int().positive().optional(),
  controller: z.string().min(1).optional(),
  layout: z.string().min(1).optional(),
});
export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;

export const PreviewBoardSchema = z.object({
  name: z.string(),
  keys: z.array(GeometryKeySchema),
  hands: z.object({ left: z.array(z.number().int()), right: z.array(z.number().int()) }),
  fingers: z.record(z.string(), z.string()),
  thumbs: z.array(z.number().int()),
  rows: z.array(z.object({ name: z.string(), positions: z.array(z.number().int()) })),
  homeRow: z.number().int(),
  flash: z.object({ kind: z.string(), manualReason: z.string().nullable(), steps: z.array(z.string()) }),
  assumedController: z.string().nullable(),
});
export type PreviewBoard = z.infer<typeof PreviewBoardSchema>;

export const PreviewResponseSchema = z.object({
  candidate: z.object({ id: z.string(), name: z.string(), firmware: z.enum(["qmk", "zmk"]) }),
  keyCount: z.number().int(),
  rows: z.array(z.object({ row: z.number().int(), keys: z.number().int() })),
  guessedHomeRow: z.number().int(),
  layout: z.string().nullable(),
  needs: z.array(z.string()),
  controllers: z.array(z.object({ id: z.string(), name: z.string() })),
  board: PreviewBoardSchema.nullable(),
  boardProblem: z.string().nullable(),
  // The name to show: "Corne (new)" when a board keyloom already has is called the same (D-336).
  displayName: z.string(),
});
export type PreviewResponse = z.infer<typeof PreviewResponseSchema>;

export const AddRequestSchema = PreviewRequestSchema.extend({ homeRow: z.number().int().positive() });
export type AddRequest = z.infer<typeof AddRequestSchema>;
export const AddResponseSchema = z.object({ boardId: z.string(), name: z.string(), displayName: z.string(), warnings: z.array(z.string()) });
export type AddResponse = z.infer<typeof AddResponseSchema>;

export const PutRequestSchema = z.object({
  from: z.string().min(1),
  board: z.string().min(1),
  name: z.string().min(1).optional(),
  // Source position (as a string key) to the target key chosen for a layer key with no counterpart.
  placements: z.record(z.string(), z.number().int().nonnegative()).optional(),
  // Source layers to carry over; omitted means all non-test layers.
  layers: z.array(z.string().min(1)).optional(),
});
export type PutRequest = z.infer<typeof PutRequestSchema>;

const PlacementSchema = z.object({
  blocked: z.string().optional(),
  layerId: z.string(),
  layerName: z.string(),
  source: z.number().int(),
  sourceName: z.string(),
  candidates: z.array(z.object({ target: z.number().int(), name: z.string(), replaces: z.string().optional() })),
});
const PlanSchema = z.object({
  placements: z.array(PlacementSchema),
  layers: z.array(z.object({ source: z.string(), target: z.string(), carried: z.number().int(), guessed: z.number().int(), notCarried: z.number().int() })),
  notCarried: z.array(z.object({ layerName: z.string(), source: z.number().int(), sourceName: z.string(), why: z.string() })),
  combos: z.object({ copied: z.array(z.string()), skipped: z.array(z.object({ id: z.string(), why: z.string() })) }),
  notes: z.array(z.string()),
});

export const PutPreviewResponseSchema = PlanSchema.extend({ name: z.string(), summary: z.string(), after: LayoutSchema });
export type PutPreviewResponse = z.infer<typeof PutPreviewResponseSchema>;

export const PutResponseSchema = PlanSchema.extend({
  config: ConfigSchema,
  proposals: z.array(z.object({ changeSetId: z.string(), title: z.string(), summary: z.string(), warnings: z.number().int(), changedKeys: z.number().int() })),
});
export type PutResponse = z.infer<typeof PutResponseSchema>;
