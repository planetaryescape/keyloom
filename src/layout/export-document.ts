// The keyloom layout document: the file `keyloom layout export` writes and `keyloom config new --from import`
// reads back (10, D-032). It wraps the layout IR unchanged, so a round trip carries every layer, macro, tap
// dance, combo, conditional layer, hold-tap profile, setting and passthrough. The envelope is snake_case like
// every CLI JSON (src/cli/output.ts's schema_version); the IR inside keeps its own camelCase `schemaVersion`.
import { z } from "zod";
import { LayoutSchema } from "./schema.ts";

export const LAYOUT_EXPORT_KIND = "keyloom-layout";
/** Version 1 is the first document keyloom writes. A document from a newer keyloom is refused, not guessed at. */
export const LAYOUT_EXPORT_SCHEMA_VERSION = 1;

export const LayoutExportDocumentSchema = z.object({
  kind: z.literal(LAYOUT_EXPORT_KIND),
  schema_version: z.literal(LAYOUT_EXPORT_SCHEMA_VERSION),
  /** The board this layout belongs to; a re-import must name the same board. */
  board_id: z.string().min(1),
  /** The layout's name when it was exported, so an import without --name reads the same. */
  layout_name: z.string().min(1).optional(),
  /** The revision the document was read from. Informational: an import starts a new history. */
  revision_id: z.string().min(1).optional(),
  layout: LayoutSchema,
});
export type LayoutExportDocument = z.infer<typeof LayoutExportDocumentSchema>;

export function buildLayoutExportDocument(input: { name: string; revisionId: string; layout: LayoutExportDocument["layout"] }): LayoutExportDocument {
  return {
    kind: LAYOUT_EXPORT_KIND,
    schema_version: LAYOUT_EXPORT_SCHEMA_VERSION,
    board_id: input.layout.boardId,
    layout_name: input.name,
    revision_id: input.revisionId,
    layout: input.layout,
  };
}

export type LayoutExportProbe =
  | { kind: "not-keyloom" }
  | { kind: "keyloom"; document: LayoutExportDocument }
  /** It has the marker but can't be read: truncated JSON, a newer version, or a missing field. */
  | { kind: "malformed"; reason: string };

/**
 * Recognises a keyloom document by its shape inside the file, not its extension. Anything else is
 * `not-keyloom`, so the Oryx, QMK, ZMK and Karabiner importers keep seeing what they always saw.
 */
export function probeLayoutExport(text: string): LayoutExportProbe {
  // Cheap test first: a zip or a firmware keymap is not parsed as JSON at all.
  if (!text.includes(LAYOUT_EXPORT_KIND)) return { kind: "not-keyloom" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "malformed", reason: "it isn't valid JSON, so it may be truncated" };
  }
  if (typeof value !== "object" || value === null || (value as { kind?: unknown }).kind !== LAYOUT_EXPORT_KIND) {
    return { kind: "not-keyloom" };
  }
  const version = (value as { schema_version?: unknown }).schema_version;
  if (version !== LAYOUT_EXPORT_SCHEMA_VERSION) {
    return {
      kind: "malformed",
      reason: version === undefined
        ? "it has no schema_version"
        : `its schema_version is ${JSON.stringify(version)}, and this keyloom reads ${LAYOUT_EXPORT_SCHEMA_VERSION}`,
    };
  }
  const parsed = LayoutExportDocumentSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined || first.path.length === 0 ? "" : ` at ${first.path.join(".")}`;
    return { kind: "malformed", reason: `it is not a valid keyloom layout document${where}: ${first?.message ?? "unknown problem"}` };
  }
  return { kind: "keyloom", document: parsed.data };
}
