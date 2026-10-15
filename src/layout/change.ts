// Change operations (docs/blueprint/03-agent.md#proposals). The editor, the agent, the CLI and the
// validator all speak this one vocabulary; src/layout/apply-ops.ts applies it.
import { z } from "zod";
import {
  BindingSchema, ComboSchema, FirmwareSettingSchema, HoldTapProfileSchema, LayerSchema, MacroSchema,
} from "./schema.ts";

export const SlotSchema = z.object({
  layerId: z.string().min(1),
  position: z.number().int().nonnegative(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const ChangeOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setBinding"), at: SlotSchema, binding: BindingSchema }),
  // What was at `to` is displaced; `from` becomes transparent on non-base layers and none on the base layer.
  z.object({ op: z.literal("moveBinding"), from: SlotSchema, to: SlotSchema }),
  z.object({ op: z.literal("swapBindings"), a: SlotSchema, b: SlotSchema }),
  // The new layer is filled with transparent bindings.
  z.object({
    op: z.literal("addLayer"),
    layer: z.object({ id: LayerSchema.shape.id, name: z.string().min(1) }),
    afterLayerId: z.string().min(1),
  }),
  z.object({ op: z.literal("removeLayer"), layerId: z.string().min(1) }),
  z.object({ op: z.literal("renameLayer"), layerId: z.string().min(1), name: z.string().min(1) }),
  z.object({ op: z.literal("upsertMacro"), macro: MacroSchema }),
  z.object({ op: z.literal("removeMacro"), macroId: z.string().min(1) }),
  z.object({ op: z.literal("upsertCombo"), combo: ComboSchema }),
  z.object({ op: z.literal("removeCombo"), comboId: z.string().min(1) }),
  z.object({ op: z.literal("upsertHoldTapProfile"), profile: HoldTapProfileSchema }),
  z.object({ op: z.literal("setFirmwareSetting"), setting: FirmwareSettingSchema }),
  // The only way to lose a function (07, D-020).
  z.object({ op: z.literal("dropFunction"), function: z.string().min(1), reason: z.string().min(1) }),
]);
export type ChangeOp = z.infer<typeof ChangeOpSchema>;

/** Why apply-ops couldn't apply an op: the op names something the document doesn't have. */
export type OpError = { index: number; code: "unknown_ref" | "schema"; message: string };
