// Layout Editor .keymap (+ optional .conf) -> keyloom Layout + import report (06).
import type { BoardDefinition } from "../../boards/schema.ts";
import type { ImportReport, NativeItem } from "../../layout/import-report.ts";
import {
  type Binding, type Combo, type HoldTapProfile, type Layout, LayoutSchema, type Macro, type Passthrough,
} from "../../layout/schema.ts";
import { type MapContext, mapBinding } from "./bindings.ts";
import { BUILTIN_NAMES, BUILTIN_OPTIONS, BUILTIN_PROFILES, type HoldKind } from "./builtins.ts";
import { parseCalls } from "./cells.ts";
import { parseConf } from "./conf.ts";
import { type Defines, evalInt } from "./defines.ts";
import { type DtItem, type DtNode, parseDts } from "./dts.ts";
import { BASE_INCLUDES, CONF_FILE, KEYMAP_FILE, MAX_LAYERS } from "./files.ts";
import { importCombo } from "./import-combos.ts";
import { importHoldTap, importMacro, isHoldTap, isMacro } from "./import-behaviors.ts";
import { ZmkImportError } from "./import-error.ts";
import { type OptionValue, cellsOf, optionOf, stringOf } from "./props.ts";
import { slug } from "./slug.ts";
import { type ZmkSourceFiles, readZmkSource } from "./source.ts";

export { ZmkImportError } from "./import-error.ts";

export type ZmkImportResult = { layout: Layout; report: ImportReport; suggestedName: string };

// Where each kind of verbatim block goes in the generated file; the importer sorts into the same order so
// import, generate, import is stable (06).
const SECTION_ORDER = ["include", "define", "cpp", "behavior", "macro", "root", "combo", "top", "conf"] as const;
type Section = (typeof SECTION_ORDER)[number];

type Kept = { section: Section; file: string; anchor: string; source: string };

const LAYER_REF = /&(mo|tog|to|sl|lt)\s/;

const emptyCounts = (): ImportReport["bindings"] => ({
  key: 0, modifier: 0, holdTap: 0, layer: 0, macro: 0, transparent: 0, none: 0, native: 0,
});

export async function importZmkSource(path: string, board: BoardDefinition): Promise<ZmkImportResult> {
  return importZmk(await readZmkSource(path), board);
}

export async function importZmk(files: ZmkSourceFiles, board: BoardDefinition): Promise<ZmkImportResult> {
  if (board.firmware !== "zmk") throw new ZmkImportError(`board ${board.id} is ${board.firmware}, not zmk`);
  const warnings: string[] = [];
  const items = await parseDts(files.keymap);

  const defines = new Map<string, string>();
  const kept: Kept[] = [];
  const keep = (section: Section, anchor: string, source: string, file = KEYMAP_FILE) => kept.push({ section, file, anchor, source });
  const roots: DtNode[] = [];
  const topLevel: DtNode[] = [];

  for (const item of items) sortItem(item, defines, kept, roots, topLevel);

  // --- keymap --------------------------------------------------------------------------------
  const keymapNodes = roots.flatMap((r) => r.children.filter((c) => c.name === "keymap" || stringOf(c, "compatible") === "zmk,keymap"));
  if (keymapNodes.length !== 1) {
    throw new ZmkImportError(keymapNodes.length === 0 ? "no keymap node found; is this the Layout Editor's .keymap export?" : "more than one keymap node");
  }
  const layerNodes = (keymapNodes[0] as DtNode).children.filter((c) => c.props.some((p) => p.name === "bindings"));
  if (layerNodes.length === 0) throw new ZmkImportError("the keymap has no layers");
  if (layerNodes.length > MAX_LAYERS) throw new ZmkImportError(`the keymap has ${layerNodes.length} layers; ZMK supports at most ${MAX_LAYERS}`);
  const layerIdSet = new Set<string>();
  const layerIds = layerNodes.map((n) => {
    const id = slug(n.name, layerIdSet);
    layerIdSet.add(id);
    return id;
  });

  // --- behaviours and macros, before the bindings that use them ------------------------------
  const profiles = new Map<string, HoldTapProfile>();
  const holdKinds = new Map<string, HoldKind>(BUILTIN_PROFILES);
  const macros: Macro[] = [];
  for (const root of roots) {
    for (const container of root.children) {
      if (container === keymapNodes[0]) continue;
      if (container.name === "behaviors") {
        for (const n of container.children) {
          const r = isHoldTap(n) ? importHoldTap(n, defines) : "keyloom doesn't model this kind of behaviour";
          if (typeof r === "string") {
            keep("behavior", `behavior:${n.label ?? n.name}`, n.source);
            if (isHoldTap(n)) warnings.push(`hold-tap ${n.label ?? n.name} kept as written: ${r}`);
          } else {
            profiles.set(r.profile.id, r.profile);
            holdKinds.set(r.profile.id, r.hold);
          }
        }
      } else if (container.name === "macros") {
        for (const n of container.children) {
          const r = isMacro(n) ? importMacro(n, defines) : "keyloom doesn't model this kind of behaviour";
          if (typeof r === "string") {
            keep("macro", `macro:${n.label ?? n.name}`, n.source);
            warnings.push(`macro ${n.label ?? n.name} kept as written: ${r}`);
          } else macros.push(r);
        }
      } else if (container.name !== "combos" && stringOf(container, "compatible") !== "zmk,combos") {
        keep("root", `root:${container.name}`, container.source);
      }
    }
  }

  // &mt { ... } and &hm { ... } adjust a behaviour that is defined elsewhere; those on a behaviour keyloom models become its options.
  for (const n of topLevel) {
    const target = n.ref;
    if (target !== undefined && (profiles.has(target) || BUILTIN_PROFILES.has(target)) && n.children.length === 0) {
      const options: Record<string, OptionValue> = {};
      let ok = true;
      for (const p of n.props) {
        const v = optionOf(p, defines);
        if (v === undefined) ok = false;
        else options[p.name] = v;
      }
      if (ok) {
        const base = profiles.get(target) ?? { id: target, name: BUILTIN_NAMES[target] as string, firmware: "zmk" as const, options: { ...BUILTIN_OPTIONS[target] } };
        profiles.set(target, { ...base, options: { ...base.options, ...options } });
        continue;
      }
    }
    keep("top", `top:${n.ref ?? n.name}`, n.source);
  }

  const macroLabels = new Set(macros.map((m) => m.id));
  const ctx: MapContext = { layerIds, defines, profiles: holdKinds, macros: macroLabels };

  // --- layers ---------------------------------------------------------------------------------
  const counts = emptyCounts();
  const native: NativeItem[] = [];
  const usedProfiles = new Set<string>();
  const layers = layerNodes.map((n, li) => {
    const layerId = layerIds[li] as string;
    const calls = cellsOf(n, "bindings").flatMap((c) => parseCalls(c).calls);
    if (calls.length !== board.keyCount) {
      throw new ZmkImportError(`layer ${n.name} has ${calls.length} bindings, but ${board.id} has ${board.keyCount}`);
    }
    for (const p of n.props) {
      if (!["bindings", "display-name", "label"].includes(p.name)) warnings.push(`layer ${n.name}: ${p.name} isn't imported and will be dropped`);
    }
    const bindings: Binding[] = calls.map((call, position) => {
      const mapped = mapBinding(call, ctx);
      counts[mapped.binding.kind]++;
      if (mapped.profileId) usedProfiles.add(mapped.profileId);
      if (mapped.binding.kind === "native") {
        native.push({ layerId, position, source: mapped.binding.source, label: mapped.binding.label, reason: mapped.nativeReason ?? "not modelled" });
      }
      return mapped.binding;
    });
    return { id: layerId, name: stringOf(n, "display-name") ?? stringOf(n, "label") ?? n.name, bindings };
  });

  // Built-ins are profiles only once something uses or adjusts them.
  for (const id of BUILTIN_PROFILES.keys()) {
    if (usedProfiles.has(id) && !profiles.has(id)) {
      profiles.set(id, { id, name: BUILTIN_NAMES[id] as string, firmware: "zmk", options: { ...BUILTIN_OPTIONS[id] } });
    }
  }
  const holdTapProfiles = [
    ...[...profiles.values()].filter((p) => !BUILTIN_PROFILES.has(p.id)),
    ...[...BUILTIN_PROFILES.keys()].sort().flatMap((id) => profiles.get(id) ?? []),
  ];

  // --- combos ---------------------------------------------------------------------------------
  const combos: Combo[] = [];
  const comboIds = new Set<string>();
  for (const root of roots) {
    for (const container of root.children.filter((c) => c.name === "combos" || stringOf(c, "compatible") === "zmk,combos")) {
      for (const n of container.children) {
        const r = importCombo(n, board.keyCount, ctx, defines, comboIds);
        if (typeof r === "string") {
          keep("combo", `combo:${n.name}`, n.source);
          warnings.push(`combo ${n.name} kept as written: ${r}`);
        } else {
          comboIds.add(r.id);
          combos.push(r);
        }
      }
    }
  }

  // --- settings ------------------------------------------------------------------------------
  const conf = files.conf === undefined ? { settings: [], other: [] } : parseConf(files.conf);
  for (const o of conf.other) keep("conf", `line:${o.line}`, o.text, CONF_FILE);
  if (files.conf === undefined) warnings.push("no .conf beside the .keymap; no settings imported");

  // --- assemble --------------------------------------------------------------------------------
  const passthrough: Passthrough[] = SECTION_ORDER.flatMap((section) =>
    kept
      .filter((k) => k.section === section)
      .map((k) => ({
        firmware: "zmk" as const, file: k.file, anchor: k.anchor, source: k.source,
        refersToLayerIndices: refersToLayers(k, defines, layers.length),
      })),
  );

  const layout = LayoutSchema.parse({
    schemaVersion: 1,
    boardId: board.id,
    firmware: "zmk",
    layers,
    macros,
    combos,
    holdTapProfiles,
    settings: conf.settings,
    passthrough,
  } satisfies Layout);

  return {
    layout,
    suggestedName: files.name,
    report: {
      boardId: board.id,
      layers: layers.length,
      keysPerLayer: board.keyCount,
      bindings: counts,
      macros: macros.map((m) => m.name),
      combos: combos.length,
      settings: conf.settings.length,
      profiles: holdTapProfiles.map((p) => p.id),
      native,
      passthrough: passthrough.map(({ file, anchor, refersToLayerIndices }) => ({ file, anchor, refersToLayerIndices })),
      warnings,
    },
  };
}

function sortItem(item: DtItem, defines: Map<string, string>, kept: Kept[], roots: DtNode[], topLevel: DtNode[]): void {
  switch (item.kind) {
    case "include":
      if (!BASE_INCLUDES.includes(item.text.replace(/\s+/g, " "))) kept.push({ section: "include", file: KEYMAP_FILE, anchor: `include:${item.text}`, source: item.text });
      return;
    case "define":
      if (!item.params) defines.set(item.name, item.body);
      kept.push({ section: "define", file: KEYMAP_FILE, anchor: `define:${item.name}`, source: item.text });
      return;
    case "cpp":
      kept.push({ section: "cpp", file: KEYMAP_FILE, anchor: `cpp:${item.line}`, source: item.text });
      return;
    case "node":
      (item.node.name === "/" ? roots : topLevel).push(item.node);
  }
}

/** Source that names layers by number pins their order (S3 for QMK; the same applies here). */
function refersToLayers(k: Kept, defines: Defines, layerCount: number): boolean {
  if (k.section === "define") {
    const body = defines.get(k.anchor.slice("define:".length));
    const n = body === undefined ? undefined : evalInt(body, new Map());
    return n !== undefined && n >= 0 && n < layerCount;
  }
  return LAYER_REF.test(k.source);
}
