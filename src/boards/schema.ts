// Board definition and generated geometry (docs/blueprint/04-boards-and-contributions.md).
import { z } from "zod";
import { FirmwareSchema } from "../layout/schema.ts";
import { BuildRecipeSchema, DeviceMatcherSchema, FlashRecipeSchema } from "./recipes.ts";

// One key in binding order, in key units. Generated from the pinned firmware tree (D-045).
export const GeometryKeySchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  r: z.number(),
  rx: z.number(),
  ry: z.number(),
});
export type GeometryKey = z.infer<typeof GeometryKeySchema>;

// A firmware board's geometry is derived from a pinned file in its firmware tree. A software remapper's keyboard has no
// such file, so its geometry is written by hand and says so, including whether anyone has measured it against the device.
export const FirmwareGeometrySourceSchema = z.object({ repo: z.string().url(), sha: z.string().regex(/^[0-9a-f]{40}$/), path: z.string().min(1) });
export const HandAuthoredGeometrySourceSchema = z.strictObject({
  kind: z.literal("hand-authored"),
  note: z.string().min(1),
  /** False until the key order and widths have been confirmed on the device (S36). */
  verified: z.boolean(),
});
export type HandAuthoredGeometrySource = z.infer<typeof HandAuthoredGeometrySourceSchema>;

export const GeometrySchema = z.object({
  schemaVersion: z.literal(1),
  source: z.union([FirmwareGeometrySourceSchema, HandAuthoredGeometrySourceSchema]),
  keys: z.array(GeometryKeySchema).min(1),
});
export type Geometry = z.infer<typeof GeometrySchema>;
export type FirmwareGeometry = Geometry & { source: z.infer<typeof FirmwareGeometrySourceSchema> };

export const isHandAuthored = (g: Geometry): g is Geometry & { source: HandAuthoredGeometrySource } => "kind" in g.source;

/** The ids `importLayout` can run (src/app/layouts.ts); the first two read QMK sources, the next two ZMK ones, and `karabiner-json` reads a Karabiner-Elements config. */
export const IMPORTER_IDS = ["oryx-source", "qmk-keymap", "zmk-layout-editor-keymap", "zmk-keymap", "karabiner-json"] as const;

const positions = z.array(z.number().int().nonnegative());

export const RevisionSchema = z.strictObject({
  id: z.string().min(1),
  source: z.strictObject({
    repo: z.string().url(),
    ref: z.string().min(1),
    sha: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  qmkTarget: z.string().min(1).optional(),
  build: BuildRecipeSchema,
  flash: FlashRecipeSchema,
  detect: z.object({ usbProductId: z.string().regex(/^0x[0-9a-f]{4}$/i) }).nullable(),
  // How a software remapper finds the keyboard it should take; the built-in keyboard has no USB IDs (21). Absent on firmware boards.
  device: DeviceMatcherSchema.optional(),
});
export type BoardRevision = z.infer<typeof RevisionSchema>;

export const KEYCAP_COLOURS = ["red"] as const;
export type KeycapColour = (typeof KEYCAP_COLOURS)[number];

export const BoardDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/),
  name: z.string().min(1),
  vendor: z.string().min(1),
  firmware: FirmwareSchema,
  keyCount: z.number().int().positive(),
  revisions: z.array(RevisionSchema).min(1),
  hands: z.object({ left: positions, right: positions }),
  fingers: z.record(z.string(), z.string().min(1)),
  rows: z.record(z.string(), positions),
  // The key each position is on the device, in binding order: KeyCode names, plus "FN" for the Apple fn/globe key, which has no KeyCode.
  // A software remapper needs it because it grabs physical keys by name (`defsrc`); a firmware board's keymap needs no such list.
  physicalKeys: z.array(z.string().min(1)).optional(),
  // Positions where a layer or hold key lands first when the board it came from had more thumb keys than this one has, best first (D-234:
  // Space-hold, then Caps Lock, then right Option on the MacBook). The key keeps its own tap; BK picks among them (D-019's "make room").
  holdKeyPreference: z.array(z.number().int().nonnegative()).optional(),
  // A firmware board's keys come in mirrored pairs; a staggered laptop keyboard has none, so a software board may leave this empty.
  mirror: z.record(z.string(), z.number().int().nonnegative()),
  importers: z.array(z.enum(IMPORTER_IDS)).min(1),
  // Per-key RGB (D-190): `ledPositions[i]` is the key position LED number i sits under. Absent means the board has no per-key lighting keyloom writes.
  lighting: z.strictObject({ ledPositions: z.array(z.number().int().nonnegative()).min(1) }).optional(),
  // Why the board lacks something people ask for, in one sentence they can read (20#capabilities). The agent and the validator quote it
  // instead of offering what the board cannot do. Only `lighting` for now: it is absent exactly when `lighting` above is.
  limits: z.strictObject({ lighting: z.string().min(1) }).optional(),
  // Where this board differs from the firmware's own default for a setting on the settings page, such as mouse keys on a Moonlander.
  settingDefaults: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
  // Display-only rotation; never affects positions or generation (04).
  display: z
    .strictObject({
      rotate: z.array(z.strictObject({ positions, r: z.number(), rx: z.number(), ry: z.number() })).optional(),
      // Slides keys sideways, in key units, after rotation. QMK's Moonlander halves are 4u apart, too close for the thumb clusters to tilt inward without meeting.
      // dy moves keys down, for a row drawn taller than the geometry has it (a MacBook Pro's full-height function row).
      shift: z.array(z.strictObject({ positions, dx: z.number(), dy: z.number().optional() })).optional(),
      // The physical keycap's colour where it is not the board's usual one (the Moonlander's red thumb keys), by position.
      keycaps: z.record(z.string().regex(/^\d+$/), z.enum(KEYCAP_COLOURS)).optional(),
      // How the case under the keys is drawn (D-266): "wells" sinks each column into a sculpted well (the Glove80), "deck" is a laptop's
      // aluminium deck with the keys in a recess. Absent is a flat slab.
      surface: z.enum(["wells", "deck"]).optional(),
      // Status LEDs on the case, in key units after rotation and shift (the Moonlander's three per half). They light in the layer's colour.
      statusLeds: z.array(z.strictObject({ x: z.number(), y: z.number() })).optional(),
      // The case hugs the keys instead of wrapping them in one outline, reaching this far past each key, in key units (the Glove80's
      // stepped columns and curved thumb band). Keys turned about a shared point make a curved band around that point.
      caseHug: z.number().positive().max(1).optional(),
      // A drawn key whose cap isn't the geometry's rectangle (the Moonlander's red "house" thumb cap): a box that replaces the key's own,
      // in the same unrotated units, and the cap's outline as points in fractions of that box. Binding order and position never change.
      keyShapes: z
        .record(
          z.string().regex(/^\d+$/),
          z.strictObject({
            x: z.number().optional(),
            y: z.number().optional(),
            w: z.number().positive().optional(),
            h: z.number().positive().optional(),
            outline: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3).optional(),
          }),
        )
        .optional(),
      // The case drawn from the real object instead of computed from the keys (D-277): SVG paths in key units after rotation and shift.
      // Kinds: body and module are the case, deck and recess a laptop's top case and keyboard well, screen a display's dark cover,
      // grille a speaker grille, sensor a fingerprint key, leg and knob metal tenting parts, knurl fine lines (a knob's knurling, a sensor's ring), hole a pinhole.
      case: z
        .array(
          z.strictObject({
            hand: z.enum(["left", "right"]).nullable(),
            kind: z.enum(["body", "module", "deck", "recess", "screen", "grille", "sensor", "leg", "knob", "knurl", "hole"]),
            d: z.string().min(1),
          }),
        )
        .optional(),
    })
    .optional(),
});
export type BoardDefinition = z.infer<typeof BoardDefinitionSchema>;

/** A board whose "firmware" is a software remapper's config file: nothing to build in Docker or flash (21). */
export const isRemapperBoard = (def: Pick<BoardDefinition, "firmware">): boolean => def.firmware === "kanata";
