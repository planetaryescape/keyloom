// Configs and versions (rung 23, 25): the routes the config switcher and History's version milestones call.
//   GET  /api/configs[?board=<id>][&archived=1]    -> ConfigListResponse (newest edited first; archived ones only with archived=1)
//   POST /api/configs                  NewConfigRequest -> NewConfigResponse (201; from "import" carries the file as base64, up to about 1 MB; 400 usage for a taken or empty name, 404 for an unknown source)
//   POST /api/configs/:ref/rename      RenameConfigRequest -> ConfigResponse
//   POST /api/configs/:ref/archive     {} -> ConfigResponse (400 usage for the config on the keyboard)
//   POST /api/configs/:ref/restore     {} -> ConfigResponse
//   POST /api/configs/:ref/delete      DeleteConfigRequest -> {} (400 usage unless the name matches; 400 for the config on the keyboard)
//   POST /api/configs/:ref/use         {} -> SyncNowResponse (202): makes it the config on the keyboard and starts one sync;
//                                      400 usage, and the choice unchanged, when the keyboard can't be synced right now
//   GET  /api/configs/:ref/versions    -> VersionHistoryResponse (versions newest first with the revisions folded under each)
//   POST /api/configs/:ref/versions/name    NameVersionRequest -> NameVersionResponse (an empty name clears it)
//   POST /api/configs/:ref/versions/restore RestoreVersionRequest -> RestoreVersionResponse (a new revision, D-170; 422 when it breaks a rule the head doesn't)
//   GET  /api/configs/:ref/compare?to=<revision|version id|version name> -> CompareResponse (the revision against the head, key by key)
//   GET  /api/configs/:ref/proposals   -> ProposalsResponse (open proposals no conversation shows, such as a keyboard put's; D-336)
// `:ref` is a config's ID or exact name. A config is a layout, so `layoutId` elsewhere in the API is a config's ID.
import { z } from "zod";
import { BindingSchema, LayoutSchema } from "../layout/schema.ts";
import { ProposalCardSchema } from "./http.ts";

export const ConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  boardId: z.string().min(1),
  boardName: z.string().min(1),
  headRevisionId: z.string().min(1),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  // The one the sync engine keeps on this board's keyboard (D-300).
  onKeyboard: z.boolean(),
  archivedAt: z.number().finite().nullable(),
  // layoutName is null when the config it was copied from has been deleted.
  copiedFrom: z.object({ layoutId: z.string().min(1), layoutName: z.string().nullable(), revisionId: z.string().min(1) }).nullable(),
});
export type ApiConfig = z.infer<typeof ConfigSchema>;

export const ConfigListResponseSchema = z.object({ configs: z.array(ConfigSchema) });
export const ConfigResponseSchema = z.object({ config: ConfigSchema });
// A new config also says where it started, such as the reason a blank one has no default keymap (D-370).
export const NewConfigResponseSchema = ConfigResponseSchema.extend({ note: z.string().optional() });
export type NewConfigResponse = z.infer<typeof NewConfigResponseSchema>;

export const NewConfigRequestSchema = z.discriminatedUnion("from", [
  // revision and version are alternatives; a version is named by ID or by name.
  z.object({ from: z.literal("config"), name: z.string(), config: z.string().min(1), revision: z.string().min(1).optional(), version: z.string().min(1).optional() }),
  // The board's firmware default keymap where keyloom can read one, otherwise the empty Base layer (D-370).
  z.object({ from: z.literal("blank"), name: z.string(), board: z.string().min(1) }),
  // A file BK exported, as the bytes in base64 and the name it had (D-371); the same importers as POST /api/import.
  z.object({ from: z.literal("import"), name: z.string(), board: z.string().min(1), filename: z.string().min(1), data: z.string().min(1) }),
]);
export type NewConfigRequest = z.infer<typeof NewConfigRequestSchema>;

export const RenameConfigRequestSchema = z.object({ name: z.string() });
export const DeleteConfigRequestSchema = z.object({ name: z.string() });

const RevisionBriefSchema = z.object({
  id: z.string().min(1),
  origin: z.enum(["import", "editor", "agent", "undo"]),
  summary: z.string(),
  createdAt: z.number().finite(),
});

export const VersionSchema = z.object({
  id: z.string().min(1),
  revisionId: z.string().min(1),
  name: z.string().nullable(),
  // null for a revision that was named without ever being put on a keyboard.
  putOnAt: z.number().finite().nullable(),
  // null while it is the one on the keyboard.
  endedAt: z.number().finite().nullable(),
  current: z.boolean(),
  summary: z.string(),
  createdAt: z.number().finite(),
});

export const VersionHistoryResponseSchema = z.object({
  layoutId: z.string().min(1),
  layoutName: z.string().min(1),
  headRevisionId: z.string().min(1),
  // Revisions newer than the newest version: changes made since anything was put on the keyboard.
  pending: z.array(RevisionBriefSchema),
  versions: z.array(z.object({ version: VersionSchema, revisions: z.array(RevisionBriefSchema) })),
});
export type VersionHistoryResponse = z.infer<typeof VersionHistoryResponseSchema>;

export const NameVersionRequestSchema = z.object({ target: z.string().min(1), name: z.string() });
// null when clearing the name left nothing (a revision that never went on a keyboard).
export const NameVersionResponseSchema = z.object({ version: VersionSchema.nullable() });

export const RestoreVersionRequestSchema = z.object({ target: z.string().min(1) });
export const RestoreVersionResponseSchema = z.object({ revisionId: z.string().min(1), restoredRevisionId: z.string().min(1) });

export const KeyChangeSchema = z.object({
  layerId: z.string().min(1),
  layerName: z.string().min(1),
  position: z.number().int().nonnegative(),
  before: BindingSchema,
  after: BindingSchema,
  beforeLabel: z.string(),
  afterLabel: z.string(),
});

const NamedChangeSchema = z.object({ added: z.array(z.string()), removed: z.array(z.string()), changed: z.array(z.string()) });

export const CompareResponseSchema = z.object({
  layoutId: z.string().min(1),
  from: RevisionBriefSchema,
  to: RevisionBriefSchema,
  // What the older revision's layers, macros and tap dances were, so a screen can say what a key did then in words (D-316), not
  // only by its firmware label ("TD0").
  fromContext: LayoutSchema.pick({ layers: true, macros: true, tapDances: true, passthrough: true }),
  diff: z.object({
    keys: z.array(KeyChangeSchema),
    layersAdded: z.array(z.object({ id: z.string(), name: z.string() })),
    layersRemoved: z.array(z.object({ id: z.string(), name: z.string() })),
    layersRenamed: z.array(z.object({ id: z.string(), from: z.string(), to: z.string() })),
    layersReordered: z.boolean(),
    lighting: z.array(z.string()),
    encoderTurns: z.array(z.string()).default([]),
    macros: NamedChangeSchema,
    tapDances: NamedChangeSchema,
    combos: NamedChangeSchema,
    conditionalLayers: NamedChangeSchema,
    holdTapProfiles: NamedChangeSchema,
    settings: z.array(z.object({ firmware: z.string(), key: z.string(), before: z.union([z.string(), z.number(), z.boolean()]).nullable(), after: z.union([z.string(), z.number(), z.boolean()]).nullable() })),
    passthrough: z.boolean(),
    same: z.boolean(),
  }),
});
export type CompareResponse = z.infer<typeof CompareResponseSchema>;

export const ProposalsResponseSchema = z.object({ proposals: z.array(ProposalCardSchema) });
export type ProposalsResponse = z.infer<typeof ProposalsResponseSchema>;
