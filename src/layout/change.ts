// Change operations (docs/blueprint/03-agent.md#proposals). The editor, the agent, the CLI and the
// validator all speak this one vocabulary; src/layout/apply-ops.ts applies it.
import { z } from "zod";
import {
  BindingSchema, ComboSchema, ConditionalLayerSchema, FirmwareSettingSchema, FirmwareSchema, HoldTapProfileSchema, LayerLightingSchema, LayerSchema, MacroSchema, TapDanceSchema,
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
  // Copies the layer's bindings under a new id, as the last layer so no other layer's number changes.
  z.object({
    op: z.literal("duplicateLayer"),
    layerId: z.string().min(1),
    layer: z.object({ id: LayerSchema.shape.id, name: z.string().min(1) }),
  }),
  // Moves a layer to just after another, by id. The base layer stays first, so nothing goes before it.
  z.object({ op: z.literal("moveLayer"), layerId: z.string().min(1), afterLayerId: z.string().min(1) }),
  // Both fields are set together; null clears one back to its default.
  z.object({
    op: z.literal("setLayerStyle"),
    layerId: z.string().min(1),
    shortLabel: LayerSchema.shape.shortLabel.unwrap().nullable(),
    color: LayerSchema.shape.color.unwrap().nullable(),
  }),
  // Replaces the layer's whole lighting (D-190); null removes it, so the layer sets no LED colours.
  z.object({ op: z.literal("setLayerLighting"), layerId: z.string().min(1), lighting: LayerLightingSchema.nullable() }),
  z.object({ op: z.literal("upsertMacro"), macro: MacroSchema }),
  z.object({ op: z.literal("removeMacro"), macroId: z.string().min(1) }),
  z.object({ op: z.literal("upsertTapDance"), tapDance: TapDanceSchema }),
  z.object({ op: z.literal("removeTapDance"), tapDanceId: z.string().min(1) }),
  z.object({ op: z.literal("upsertCombo"), combo: ComboSchema }),
  z.object({ op: z.literal("removeCombo"), comboId: z.string().min(1) }),
  // "When two layers are both on, also turn a third on" (D-385). Layers are named by id, so moving layers needs no edit here.
  z.object({ op: z.literal("upsertConditionalLayer"), conditionalLayer: ConditionalLayerSchema }),
  z.object({ op: z.literal("removeConditionalLayer"), conditionalLayerId: z.string().min(1) }),
  z.object({ op: z.literal("upsertHoldTapProfile"), profile: HoldTapProfileSchema }),
  z.object({ op: z.literal("setFirmwareSetting"), setting: FirmwareSettingSchema }),
  // Back to the firmware's own default: the option is no longer written (D-191).
  z.object({ op: z.literal("removeFirmwareSetting"), firmware: FirmwareSchema, key: z.string().min(1) }),
  // The only way to lose a function (07, D-020).
  z.object({ op: z.literal("dropFunction"), function: z.string().min(1), reason: z.string().min(1) }),
]);
export type ChangeOp = z.infer<typeof ChangeOpSchema>;

// What the agent writes down with a proposal so that applying it can remember why (08, D-023). It is
// the words only: the subject (which keys) comes from the validator's diff at apply time.
export const DecisionDraftSchema = z.object({
  goal: z.string().trim().min(1).max(300).describe("The frustration or goal this answers, in BK's words where he gave them."),
  choice: z.string().trim().min(1).max(300).describe('What was chosen, such as "Command-Shift on key 60, with Backspace moved to key 12".'),
  reason: z.string().trim().min(1).max(500).describe('Why this choice and not another, so BK can judge it months later. Address him directly ("You barely use F16"), never as "BK".'),
  scope: z
    .object({
      apps: z.array(z.string().trim().min(1)).max(10).describe("Apps it matters in; empty if none were named."),
      habits: z.array(z.string().trim().min(1)).max(10).describe('Habits it serves, such as "Command-Shift shortcuts with the left hand".'),
    })
    .describe("Where and how it applies."),
});
export type DecisionDraft = z.infer<typeof DecisionDraftSchema>;

/** Why apply-ops couldn't apply an op: the op names something the document doesn't have. */
export type OpError = { index: number; code: "unknown_ref" | "schema"; message: string };
