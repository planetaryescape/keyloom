// The editor's "Any" field (16#the-key-panel): a firmware expression typed by a person, read with
// the importers' own mapping and answered as a binding. The web can't import src/firmware
// (dependency-cruiser), so the reading happens here.
import { parseQmkExpression } from "../firmware/qmk/parse-expression.ts";
import { BUILTIN_PROFILES, type HoldKind } from "../firmware/zmk/builtins.ts";
import { parseZmkExpression } from "../firmware/zmk/parse-expression.ts";
import type { Binding, Layout } from "../layout/schema.ts";
import type { App } from "./context.ts";
import { getLayout } from "./layouts.ts";

export type ParsedBinding =
  | { ok: true; binding: Binding; native: boolean; note?: string }
  | { ok: false; message: string };

const holdKindOf = (layout: Layout, profileId: string): HoldKind => {
  const user = layout.layers.flatMap((layer) => layer.bindings).find((b) => b.kind === "holdTap" && b.profileId === profileId);
  if (user?.kind === "holdTap") return "layerId" in user.hold ? "layer" : "mods";
  // A profile nothing uses yet: the importer's QMK ids and ZMK's `lt` say what they are for.
  return BUILTIN_PROFILES.get(profileId) ?? (/layer|(^|-)lt$/.test(profileId) ? "layer" : "mods");
};

// A hold-tap whose profile the layout doesn't have would fail validation, so it borrows the
// layout's closest profile and says so; the person can pick another in the panel.
function withKnownProfile(layout: Layout, binding: Binding): { binding: Binding; note?: string } {
  if (binding.kind !== "holdTap" || layout.holdTapProfiles.some((p) => p.id === binding.profileId)) return { binding };
  const wantsLayer = "layerId" in binding.hold;
  const candidates = layout.holdTapProfiles.filter((p) => p.firmware === layout.firmware);
  const best = candidates.find((p) => holdKindOf(layout, p.id) === (wantsLayer ? "layer" : "mods")) ?? candidates[0];
  if (best === undefined) return { binding };
  return { binding: { ...binding, profileId: best.id }, note: `This layout has no "${binding.profileId}" timing profile, so "${best.name}" is used. You can pick another.` };
}

export async function parseBindingExpression(app: App, ref: string, input: { expression: string; position?: number | undefined }): Promise<ParsedBinding> {
  const { document: layout, board } = getLayout(app, ref);
  const position = input.position ?? -1;
  const layerIds = layout.layers.map((layer) => layer.id);
  if (layout.firmware === "qmk") {
    const home = new Set(board.definition.rows.home ?? []);
    const macroIds = new Map(layout.macros.flatMap((macro) => [[macro.id, macro.id] as const, [macro.name, macro.id] as const]));
    const parsed = await parseQmkExpression(input.expression, position, {
      layerIds, isHomeRow: (p) => home.has(p), macroIds, customKeycodes: new Set(),
    });
    if (!parsed.ok) return parsed;
    const known = withKnownProfile(layout, parsed.mapped.binding);
    return finish(known.binding, known.note);
  }
  const holdKinds = new Map<string, HoldKind>(BUILTIN_PROFILES);
  for (const profile of layout.holdTapProfiles) holdKinds.set(profile.id, holdKindOf(layout, profile.id));
  const parsed = parseZmkExpression(input.expression, {
    layerIds, defines: new Map(), profiles: holdKinds, macros: new Set(layout.macros.map((macro) => macro.id)),
  });
  if (!parsed.ok) return parsed;
  const known = withKnownProfile(layout, parsed.mapped.binding);
  return finish(known.binding, known.note);
}

function finish(binding: Binding, note: string | undefined): ParsedBinding {
  return { ok: true, binding, native: binding.kind === "native", ...(note === undefined ? {} : { note }) };
}
