// Wire format shared by the server and the browser client. The layout, board and
// geometry schemas are imported from their owning modules, not redefined here.
import { z } from "zod";
import { BoardDefinitionSchema, GeometrySchema } from "../boards/schema.ts";
import { LayoutSchema } from "../layout/schema.ts";

export const LayoutSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  boardId: z.string().min(1),
  updatedAt: z.number().finite(),
});
export type LayoutSummary = z.infer<typeof LayoutSummarySchema>;

export const LayoutListResponseSchema = z.object({
  layouts: z.array(LayoutSummarySchema),
});

export const LayoutDetailSchema = z.object({
  document: LayoutSchema,
  board: BoardDefinitionSchema,
  geometry: GeometrySchema,
});
export type LayoutDetail = z.infer<typeof LayoutDetailSchema>;
