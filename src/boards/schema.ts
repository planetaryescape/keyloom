// Board definition and generated geometry (docs/blueprint/04-boards-and-contributions.md).
import { z } from "zod";
import { FirmwareSchema } from "../layout/schema.ts";

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

export const GeometrySchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({ repo: z.string().url(), sha: z.string().regex(/^[0-9a-f]{40}$/), path: z.string().min(1) }),
  keys: z.array(GeometryKeySchema).min(1),
});
export type Geometry = z.infer<typeof GeometrySchema>;

const positions = z.array(z.number().int().nonnegative());

export const RevisionSchema = z.object({
  id: z.string().min(1),
  source: z.object({
    repo: z.string().url(),
    ref: z.string().min(1),
    sha: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  qmkTarget: z.string().min(1).optional(),
  build: z.object({ kind: z.enum(["qmk-docker", "zmk-moergo-template"]) }).passthrough(),
  flash: z.object({ kind: z.enum(["zapp", "uf2-drives"]) }).passthrough(),
  detect: z.object({ usbProductId: z.string().regex(/^0x[0-9a-f]{4}$/i) }).nullable(),
});
export type BoardRevision = z.infer<typeof RevisionSchema>;

export const BoardDefinitionSchema = z.object({
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
  mirror: z.record(z.string(), z.number().int().nonnegative()),
  importers: z.array(z.string().min(1)).min(1),
  // Display-only rotation; never affects positions or generation (04).
  display: z
    .object({
      rotate: z.array(z.object({ positions, r: z.number(), rx: z.number(), ry: z.number() })),
    })
    .optional(),
});
export type BoardDefinition = z.infer<typeof BoardDefinitionSchema>;
