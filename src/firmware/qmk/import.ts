// Oryx source (keymap.c, config.h, rules.mk, keymap.json) -> keyloom Layout + import report (05).
import type { BoardDefinition } from "../../boards/schema.ts";
import type { ImportReport, NativeItem, PassthroughItem } from "../../layout/import-report.ts";
import { fromQmk } from "../../layout/keycodes.ts";
import {
  type Binding, type Combo, type FirmwareSetting, type HoldTapProfile, type Layout, LayoutSchema, type Macro, type Passthrough,
} from "../../layout/schema.ts";
import { type MapContext, PROFILE_HOME_ROW, PROFILE_LAYER_TAP, PROFILE_MOD_TAP, mapKey } from "./bindings.ts";
import type { Expr } from "./c-parse.ts";
import { PASSTHROUGH_DEFINES, parseDefines, settingsFrom, tapHoldOptions } from "./config-h.ts";
import { CUSTOM_KEYCODES_ANCHOR, type ParsedKeymap, parseKeymapC } from "./keymap-c.ts";
import { macroNames } from "./emit-macros.ts";
import { annotateQmkLayerRefs } from "./layer-refs.ts";
import { readTriLayers } from "./import-tri-layer.ts";
import { importTapDances } from "./import-tap-dance.ts";
import { readLighting } from "./import-lighting.ts";
import { macroFor, parseMacroCase } from "./send-string.ts";
import { ImportError, type SourceFiles, readOryxSource } from "./source.ts";

export { ImportError } from "./source.ts";
export type { ImportReport, NativeItem, PassthroughItem } from "../../layout/import-report.ts";

export type ImportResult = { layout: Layout; report: ImportReport; suggestedName: string };

/** Normal form for matching a combo's key to the base-layer binding that produces it: KC_ESC equals KC_ESCAPE. */
function canon(e: Expr): string {
  switch (e.kind) {
    case "id":
      return fromQmk(e.name)?.name ?? e.name;
    case "num":
      return String(e.value);
    case "call":
      return `${e.name}(${e.args.map(canon).join(",")})`;
    case "or":
      return e.operands.map(canon).sort().join("|");
    case "other":
      return e.text.replace(/\s+/g, "");
  }
}

const emptyCounts = (): ImportReport["bindings"] => ({
  key: 0, modifier: 0, holdTap: 0, layer: 0, macro: 0, tapDance: 0, transparent: 0, none: 0, native: 0,
});

const PROFILE_NAMES: Array<[string, string]> = [
  [PROFILE_HOME_ROW, "Home-row mods"],
  [PROFILE_MOD_TAP, "Mod-tap"],
  [PROFILE_LAYER_TAP, "Layer-tap"],
];

const SAFE_RANGES = new Set(["SAFE_RANGE", "ZSA_SAFE_RANGE"]);

/**
 * The members of the keymap's own `enum custom_keycodes` that keyloom does not write itself, as passthrough. keyloom writes one enum:
 * ZSA's `RGB_SLD`, a member per macro (`ST_MACRO_n`, which the macros it imported already stand for), then these. The member that starts the enum
 * (`= SAFE_RANGE`) is re-based by the generator. A member keyloom's enum also writes under a name that isn't the same thing is an error.
 */
function customKeycodes(members: ParsedKeymap["keycodeEnum"], board: BoardDefinition, macros: readonly Macro[]): Passthrough[] {
  const imported = new Set(macros.map((m) => m.name));
  const generated = new Set(macroNames(macros).values());
  const kept: string[] = [];
  for (const m of members) {
    const startsRange = m.value === undefined || SAFE_RANGES.has(m.value);
    if (m.name === "RGB_SLD" && board.vendor === "ZSA") {
      if (!startsRange) throw new ImportError(`keymap.c's enum custom_keycodes has RGB_SLD = ${m.value}, but keyloom writes ZSA's RGB_SLD itself (= ZSA_SAFE_RANGE); rename or remove yours`);
      continue;
    }
    if (imported.has(m.name)) continue;
    if (generated.has(m.name)) throw new ImportError(`keymap.c's enum custom_keycodes has ${m.name}, which keyloom's generated enum writes for a macro; rename it in the keymap`);
    kept.push(m.value === undefined || SAFE_RANGES.has(m.value) ? m.name : `${m.name} = ${m.value}`);
  }
  return kept.length === 0 ? [] : [{ firmware: "qmk", file: "keymap.c", anchor: CUSTOM_KEYCODES_ANCHOR, source: kept.join("\n"), refersToLayerIndices: false }];
}

/** A case that ran only on a press in its keymap, because its switch was inside `if (record->event.pressed)`: the guard moves into the case. */
function pressedOnly(source: string): string {
  const m = /^(case\s+[^:]+:|default\s*:)([\s\S]*)$/.exec(source);
  return m === null ? source : `${m[1]} if (record->event.pressed) {${m[2]}\n    }\n    break;`;
}

/** An enum member as the layer's name: `_BASE` is written that way to avoid a clash in C, so the leading underscores are dropped. */
const displayName = (member: string): string => member.replace(/^_+/, "") || member;

export async function importOryxSource(path: string, board: BoardDefinition): Promise<ImportResult> {
  return importQmkSource(await readOryxSource(path), board);
}

export async function importQmkSource(files: SourceFiles, board: BoardDefinition): Promise<ImportResult> {
  if (board.firmware !== "qmk") throw new ImportError(`board ${board.id} is ${board.firmware}, not qmk`);
  const warnings: string[] = [];
  const parsed = await parseKeymapC(files.keymapC);

  parsed.layers.forEach((args, i) => {
    if (args.length !== board.keyCount) {
      throw new ImportError(`layer ${i} has ${args.length} keys, but ${board.id} has ${board.keyCount}`);
    }
  });
  const layerIds = parsed.layers.map((_, i) => `layer-${i}`);

  const { macros, consumedCases } = importMacros(parsed);
  const macroIds = new Map(macros.map((m) => [m.name, m.id]));
  const homeRow = new Set(board.rows.home ?? []);
  const tri = readTriLayers(parsed, layerIds, files);
  warnings.push(...tri.warnings);
  const ctx = {
    triLayerKeys: tri.keys,
    layerIds,
    isHomeRow: (p: number) => homeRow.has(p),
    macroIds,
    customKeycodes: new Set(parsed.customKeycodes.keys()),
    layerNames: new Map(parsed.layerNames.map((name, i) => [name, i])),
  };
  const danceRead = importTapDances(parsed.chunks, { layerIds, macros, macroNames: macroNames(macros), keyCtx: ctx });
  warnings.push(...danceRead.warnings);
  const tapDanceCtx: MapContext = { ...ctx, tapDanceIds: new Map(danceRead.tapDances.map((t, i) => [`DANCE_${i}`, t.id])) };

  const counts = emptyCounts();
  const native: NativeItem[] = [];
  const profilesUsed = new Set<string>();
  const layers = parsed.layers.map((args, li) => ({
    id: layerIds[li] as string,
    name: parsed.layerNames[li] === undefined ? `Layer ${li}` : displayName(parsed.layerNames[li] as string),
    bindings: args.map((expr, position) => {
      const mapped = mapKey(expr, position, tapDanceCtx);
      counts[mapped.binding.kind]++;
      if (mapped.profileId) profilesUsed.add(mapped.profileId);
      if (mapped.binding.kind === "native") {
        native.push({
          layerId: layerIds[li] as string, position, source: mapped.binding.source, label: mapped.binding.label,
          reason: mapped.nativeReason ?? "not modelled",
        });
      }
      return mapped.binding;
    }),
  }));

  // Oryx's layer colours become lighting on the layers when they read back exactly (D-190); otherwise they stay code.
  const read = board.lighting === undefined ? null : readLighting(parsed.chunks, layers, board.lighting.ledPositions);
  if (read !== null && "problem" in read) warnings.push(read.problem);
  const lightingRead = read !== null && "lighting" in read ? read : null;
  if (lightingRead !== null) layers.forEach((layer, i) => {
    const lighting = lightingRead.lighting.get(i);
    if (lighting !== undefined) Object.assign(layer, { lighting });
  });

  const imported = importConfig(files, warnings);
  // The Tri Layer feature's layer numbers are now the condition's, written from the layers' ids; as settings they would stay pinned.
  const settings = imported.settings.filter((s) => !tri.consumedDefines.has(s.key));
  const { profileOptions, passthrough: configPassthrough } = imported;
  const holdTapProfiles: HoldTapProfile[] = PROFILE_NAMES.filter(([id]) => profilesUsed.has(id)).map(([id, name]) => ({
    id, name, firmware: "qmk", options: { ...profileOptions },
  }));

  const keycodes = customKeycodes(parsed.keycodeEnum, board, macros);
  const combos = importCombos(parsed, parsed.layers[0] ?? [], tapDanceCtx, warnings);

  // Which numbers in the kept code are layer numbers is read once everything kept is known (D-360); until then none is marked.
  const kept: Passthrough[] = [
    ...parsed.chunks.filter((c) => !danceRead.consumed.has(c.anchor) && !(lightingRead?.consumed.has(c.anchor) ?? false) && !tri.consumedChunks.has(c.anchor)).map((c) => ({ firmware: "qmk" as const, file: "keymap.c", anchor: c.anchor, source: c.source, refersToLayerIndices: false })),
    ...keycodes,
    ...parsed.cases
      .filter((c) => !consumedCases.has(c.label))
      .map((c) => {
        const source = c.pressedOnly ? pressedOnly(c.source) : c.source;
        return { firmware: "qmk" as const, file: "keymap.c", anchor: `process_record_user:${c.label}`, source, refersToLayerIndices: false };
      }),
    ...configPassthrough,
    ...(files.rulesMk === undefined ? [] : [wholeFile("rules.mk", files.rulesMk)]),
    ...(files.keymapJson === undefined ? [] : [wholeFile("keymap.json", files.keymapJson)]),
  ];

  const numbered = await annotateQmkLayerRefs({ layers, combos, passthrough: kept }, layerIds);
  const passthrough = numbered.passthrough;

  const layout = LayoutSchema.parse({
    schemaVersion: 1,
    boardId: board.id,
    firmware: "qmk",
    layers: numbered.layers,
    macros,
    tapDances: danceRead.tapDances,
    combos: numbered.combos,
    conditionalLayers: tri.conditionalLayers,
    holdTapProfiles,
    settings,
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
      tapDances: danceRead.tapDances.map((t) => t.name),
      combos: combos.length,
      settings: settings.length,
      profiles: holdTapProfiles.map((p) => p.id),
      native,
      passthrough: passthrough.map(({ file, anchor, refersToLayerIndices: r }) => ({ file, anchor, refersToLayerIndices: r })),
      warnings,
    },
  };
}

const wholeFile = (file: string, source: string): Passthrough => ({
  firmware: "qmk", file, anchor: "file", source, refersToLayerIndices: false,
});

function importMacros(parsed: ParsedKeymap): { macros: Macro[]; consumedCases: Set<string> } {
  const macros: Macro[] = [];
  const consumedCases = new Set<string>();
  for (const c of parsed.cases) {
    const m = parseMacroCase(c.source);
    if (!m) continue;
    macros.push(macroFor(m.qmkName, m.steps));
    consumedCases.add(c.label);
  }
  return { macros, consumedCases };
}

function importConfig(files: SourceFiles, warnings: string[]) {
  const passthrough: Passthrough[] = [];
  if (files.configH === undefined) {
    warnings.push("no config.h in the source; no settings imported");
    return { settings: [] as FirmwareSetting[], profileOptions: {}, passthrough };
  }
  const { defines, functionLike, hasConditionals } = parseDefines(files.configH);
  if (hasConditionals) warnings.push("config.h has #if/#ifdef blocks; every #define in it was imported as if unconditional");
  for (const d of defines) {
    if (PASSTHROUGH_DEFINES.has(d.name)) {
      passthrough.push({ firmware: "qmk", file: "config.h", anchor: `define:${d.name}`, source: d.raw, refersToLayerIndices: false });
    }
  }
  for (const f of functionLike) {
    passthrough.push({ firmware: "qmk", file: "config.h", anchor: `define:${f.name}`, source: f.source, refersToLayerIndices: false });
  }
  const settings = settingsFrom(defines);
  return { settings, profileOptions: tapHoldOptions(settings), passthrough };
}

/**
 * QMK combos name keycodes, not positions. Each key is placed on the base-layer position whose
 * binding produces that keycode (05, S3). A combo that can't be placed is reported and skipped.
 */
function importCombos(parsed: ParsedKeymap, baseLayer: Expr[], ctx: MapContext, warnings: string[]): Combo[] {
  const positionsFor = new Map<string, number[]>();
  baseLayer.forEach((e, p) => {
    const key = canon(e);
    positionsFor.set(key, [...(positionsFor.get(key) ?? []), p]);
  });

  for (const text of parsed.combos.unsupported) warnings.push(`combo not imported (unsupported form): ${text}`);

  const combos: Combo[] = [];
  parsed.combos.entries.forEach((entry, i) => {
    const keys = parsed.combos.arrays.get(entry.array) ?? [];
    const positions: number[] = [];
    for (const k of keys) {
      const candidates = positionsFor.get(canon(k)) ?? [];
      const free = candidates.find((p) => !positions.includes(p));
      if (free === undefined) {
        warnings.push(`combo ${entry.array} not imported: no base-layer key produces ${k.text}`);
        return;
      }
      if (candidates.length > 1) {
        warnings.push(`combo ${entry.array}: ${k.text} is on base-layer positions ${candidates.join(", ")}; used ${free}`);
      }
      positions.push(free);
    }
    if (positions.length < 2) {
      warnings.push(`combo ${entry.array} not imported: it needs at least two keys`);
      return;
    }
    let output = mapKey(entry.output, -1, ctx).binding;
    // A combo can't output a hold-tap (07).
    if (output.kind === "holdTap") output = { kind: "native", firmware: "qmk", source: entry.output.text, label: entry.output.text };
    combos.push({ id: `combo-${i}`, name: `Combo ${i}`, positions, layerIds: "all", output });
  });
  return combos;
}
