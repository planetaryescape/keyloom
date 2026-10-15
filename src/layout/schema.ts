// The firmware-neutral layout document (docs/blueprint/02-layout-model.md).
// These zod schemas are the source of truth: types are inferred from them, and every
// read from storage, the agent or the browser is parsed with them.
import { z } from "zod";

export const FirmwareSchema = z.enum(["qmk", "zmk"]);
export type Firmware = z.infer<typeof FirmwareSchema>;

export const ModSchema = z.enum(["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"]);
export type Mod = z.infer<typeof ModSchema>;

// The closed KeyCode union is generated into src/layout/keycodes.ts (D-044). Until a
// binding is validated against that table it is only known to be a non-empty name.
export const KeyCodeNameSchema = z.string().min(1);

const mods = z.array(ModSchema).min(1);

export const TapActionSchema = z.object({
  code: KeyCodeNameSchema,
  mods: mods.optional(),
});
export type TapAction = z.infer<typeof TapActionSchema>;

export const HoldActionSchema = z.union([
  z.object({ mods }),
  z.object({ layerId: z.string().min(1) }),
]);
export type HoldAction = z.infer<typeof HoldActionSchema>;

export const BindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("key"), code: KeyCodeNameSchema, mods: mods.optional() }),
  z.object({ kind: z.literal("modifier"), mods }),
  z.object({
    kind: z.literal("holdTap"),
    tap: TapActionSchema,
    hold: HoldActionSchema,
    profileId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("layer"),
    action: z.enum(["momentary", "toggle", "to", "oneShot"]),
    layerId: z.string().min(1),
  }),
  z.object({ kind: z.literal("macro"), macroId: z.string().min(1) }),
  z.object({ kind: z.literal("tapDance"), tapDanceId: z.string().min(1) }),
  z.object({ kind: z.literal("transparent") }),
  z.object({ kind: z.literal("none") }),
  // Escape hatch for anything keyloom doesn't model (D-024).
  z.object({
    kind: z.literal("native"),
    firmware: FirmwareSchema,
    source: z.string().min(1),
    label: z.string().min(1),
  }),
]);
export type Binding = z.infer<typeof BindingSchema>;

// What one slot of a tap dance does (16#tap-dance-is-a-key-with-a-double-tap-slot, D-093). Nothing nests:
// a slot can't be a hold-tap or another tap dance, so the firmware's state machine stays flat.
export const SlotActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("key"), code: KeyCodeNameSchema, mods: mods.optional() }),
  z.object({ kind: z.literal("modifier"), mods }),
  z.object({
    kind: z.literal("layer"),
    action: z.enum(["momentary", "toggle", "to", "oneShot"]),
    layerId: z.string().min(1),
  }),
  z.object({ kind: z.literal("macro"), macroId: z.string().min(1) }),
]);
export type SlotAction = z.infer<typeof SlotActionSchema>;

export const TapDanceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tap: SlotActionSchema,
  hold: SlotActionSchema.optional(),
  doubleTap: SlotActionSchema.optional(),
  tapThenHold: SlotActionSchema.optional(),
  // Falls back to the firmware's tapping term.
  termMs: z.number().int().positive().optional(),
});
export type TapDance = z.infer<typeof TapDanceSchema>;

export const LayerSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  bindings: z.array(BindingSchema),
});
export type Layer = z.infer<typeof LayerSchema>;

export const MacroStepSchema = z.union([
  z.object({ op: z.enum(["tap", "press", "release"]), code: KeyCodeNameSchema.optional(), mods: mods.optional() }),
  z.object({ op: z.literal("waitMs"), ms: z.number().int().nonnegative() }),
  // Typed as written; the generators add Shift where a character needs it.
  z.object({ op: z.literal("text"), text: z.string().min(1) }),
]);
export type MacroStep = z.infer<typeof MacroStepSchema>;

export const MacroSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  steps: z.array(MacroStepSchema).min(1),
});
export type Macro = z.infer<typeof MacroSchema>;

export const ComboSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  positions: z.array(z.number().int().nonnegative()).min(2),
  layerIds: z.union([z.array(z.string().min(1)).min(1), z.literal("all")]),
  output: BindingSchema,
  timeoutMs: z.number().int().positive().optional(),
});
export type Combo = z.infer<typeof ComboSchema>;

export const HoldTapProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  firmware: FirmwareSchema,
  options: z.record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.array(z.number())])),
});
export type HoldTapProfile = z.infer<typeof HoldTapProfileSchema>;

export const FirmwareSettingSchema = z.object({
  firmware: FirmwareSchema,
  key: z.string().min(1),
  value: z.union([z.number(), z.boolean(), z.string()]),
});
export type FirmwareSetting = z.infer<typeof FirmwareSettingSchema>;

export const PassthroughSchema = z.object({
  firmware: FirmwareSchema,
  file: z.string().min(1),
  anchor: z.string().min(1),
  source: z.string(),
  // True when the source refers to layers by index (S3), which pins layer order.
  refersToLayerIndices: z.boolean(),
});
export type Passthrough = z.infer<typeof PassthroughSchema>;

export const LayoutSchema = z.object({
  schemaVersion: z.literal(1),
  boardId: z.string().min(1),
  firmware: FirmwareSchema,
  layers: z.array(LayerSchema).min(1),
  macros: z.array(MacroSchema),
  // Documents stored before rung 14 have no tapDances; reading one gives [] and the next save writes it.
  tapDances: z.array(TapDanceSchema).default([]),
  combos: z.array(ComboSchema),
  holdTapProfiles: z.array(HoldTapProfileSchema),
  settings: z.array(FirmwareSettingSchema),
  passthrough: z.array(PassthroughSchema),
});
export type Layout = z.infer<typeof LayoutSchema>;
