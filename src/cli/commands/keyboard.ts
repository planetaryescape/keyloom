// `keyloom keyboard` (22, 10#commands): see what is plugged in, build a board for a keyboard keyloom has never met, and put a config on it.
// Thin: each calls one use case in src/app. Nothing here flashes, and nothing writes to a device.
import type { Command } from "commander";
import { z } from "zod";
import {
  type AddDeps, type App, type CandidateView, type DetectedKeyboard, type HandsFreeOverrides, UsageError, addKeyboard, detectKeyboards, previewKeyboard, putConfig, searchKeyboards,
} from "../../app/index.ts";
import { type Format, type Io, SCHEMA_VERSION, columns, print } from "../output.ts";
import { transferReportText } from "../transfer-text.ts";
import { configJson } from "./config.ts";

export type KeyboardCommandDeps = {
  io: Io;
  format: () => Format;
  quiet: () => boolean;
  withApp: <T>(fn: (app: App) => Promise<T> | T) => Promise<T>;
  handsFree?: HandsFreeOverrides;
  keyboards?: KeyboardCliDeps;
};

/** Where `keyboard` reads the firmware tree and which boards count as known; tests pass fixtures, otherwise the pinned tree on GitHub and every loaded board. */
export type KeyboardCliDeps = AddDeps;

const pct = (c: number) => `${Math.round(c * 100)}%`;

const positionText = /^(0|[1-9]\d*)$/;
const placementsSchema = z.record(z.string().regex(positionText).refine((s) => Number.isSafeInteger(Number(s))), z.number().int().nonnegative());

function parsePlacements(items: string[]): Record<string, number> {
  const entries: Array<[string, number]> = [];
  const invalid = () => new UsageError("--placements must be source=target pairs or a JSON object of nonnegative integer positions (for example 4=10)");
  for (const item of items) {
    let input: unknown;
    if (item.trimStart().startsWith("{")) {
      try {
        input = JSON.parse(item);
      } catch {
        throw invalid();
      }
    } else {
      const pairs = item.trim().split(/[,\s]+/).map((pair): [string, number] => {
        const match = /^(0|[1-9]\d*)[=:](0|[1-9]\d*)$/.exec(pair);
        if (!match) throw invalid();
        return [match[1]!, Number(match[2])];
      });
      input = Object.fromEntries(pairs);
    }
    // Zod records intentionally omit __proto__; reject it before parsing rather than accepting an empty map.
    if (typeof input === "object" && input !== null && Object.hasOwn(input, "__proto__")) throw invalid();
    const parsed = placementsSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    entries.push(...Object.entries(parsed.data));
  }
  return Object.fromEntries(entries);
}

const candidateJson = (c: CandidateView) => ({ id: c.id, firmware: c.firmware, name: c.name, vendor: c.vendor, confidence: c.confidence, reasons: c.reasons, detail: c.detail });

const detectedJson = (k: DetectedKeyboard) => ({
  device: { vendor_id: k.device.vendorId, product_id: k.device.productId, product: k.device.product, maker: k.device.maker, bcd_device: k.device.bcdDevice },
  status: k.status,
  known_board: k.knownBoard,
  candidates: k.candidates.map(candidateJson),
  ambiguous: k.ambiguous,
  next: k.next,
});

function detectedText(k: DetectedKeyboard): string {
  const d = k.device;
  const head = `${d.product || "(no product string)"}  ${d.vendorId}:${d.productId}${d.bcdDevice ? `  v${d.bcdDevice}` : ""}${d.maker ? `  ${d.maker}` : ""}`;
  if (k.status === "known") return `${head}\n  your ${k.knownBoard?.name} (${k.knownBoard?.id})`;
  if (k.status === "unknown") return `${head}\n  looks like a ZMK keyboard, but its product string names nothing in ZMK's tree\n  next: ${k.next}`;
  const list = k.candidates.map((c) => `  ${c.id}  ${c.name}  ${pct(c.confidence)}  ${c.detail}\n    ${c.reasons.join("; ")}`).join("\n");
  return `${head}\n${k.ambiguous ? "  not sure which of these it is; choose one:\n" : ""}${list}\n  next: ${k.next}`;
}

export function registerKeyboardCommands(program: Command, deps: KeyboardCommandDeps): void {
  const { io, format, quiet, withApp } = deps;
  const keyboard = program.command("keyboard").description("keyboards on USB: detect one, build a board for one keyloom has not seen, put a config on it");

  keyboard
    .command("detect")
    .description("the QMK and ZMK keyboards on USB, and for each the board keyloom has or the candidates it could be; reads USB only")
    .option("--search <text>", "instead of USB, list keyboards whose name contains this (for one USB could not name)")
    .action(async (opts: { search?: string }) => {
      if (opts.search !== undefined) {
        const found = searchKeyboards(opts.search);
        print(io, format(), {
          json: { search: opts.search, candidates: found.map(candidateJson) },
          ids: found.map((c) => c.id),
          table: found.length === 0 ? `nothing in the index is named like "${opts.search}"` : columns([["ID", "NAME", "FIRMWARE", "DETAIL"], ...found.map((c) => [c.id, c.name, c.firmware.toUpperCase(), c.detail])]),
        });
        return;
      }
      const found = await detectKeyboards(deps.keyboards?.boards ? { boards: deps.keyboards.boards } : {}, deps.handsFree);
      print(io, format(), {
        json: { keyboards: found.map(detectedJson) },
        rows: found.map((k) => ({ schema_version: SCHEMA_VERSION, ...detectedJson(k) })),
        ids: found.flatMap((k) => (k.candidates[0] ? [k.candidates[0].id] : [])),
        table: found.length === 0 ? "no QMK or ZMK keyboard is attached" : found.map(detectedText).join("\n\n"),
      });
    });

  keyboard
    .command("add")
    .description("derive a board for a keyboard you have confirmed, check it as `boards check` does, and store it in your data directory")
    .requiredOption("--candidate <id>", "the keyboard, from `keyboard detect` (qmk:crkbd/rev1, zmk:corne)")
    .option("--home-row <n>", "which row is the home row, counting from the top row of the main block (1 is the top)")
    .option("--layout <name>", "QMK: the layout macro, when the keyboard has several")
    .option("--controller <id>", "ZMK: the controller board a shield runs on, such as nice_nano//zmk")
    .option("--force", "replace a board of the same id that was derived before")
    .action(async (opts: { candidate: string; homeRow?: string; layout?: string; controller?: string; force?: boolean }) => {
      const homeRow = opts.homeRow === undefined ? undefined : Number(opts.homeRow);
      if (homeRow !== undefined && !Number.isInteger(homeRow)) throw new UsageError(`--home-row must be a row number, got "${opts.homeRow}"`);
      const input = {
        candidate: opts.candidate,
        ...(homeRow === undefined ? {} : { homeRow }),
        ...(opts.layout === undefined ? {} : { layout: opts.layout }),
        ...(opts.controller === undefined ? {} : { controller: opts.controller }),
      };
      const preview = await previewKeyboard(input, deps.keyboards);
      if (preview.needs.length > 0) {
        const rows = preview.rows.map((r) => `  row ${r.row}: ${r.keys} keys${r.row === preview.guessedHomeRow ? "  (keyloom's guess for the home row)" : ""}`).join("\n");
        const controllers = preview.controllers.length > 0 ? `\ncontrollers keyloom can write the flash steps for: ${preview.controllers.map((c) => c.id).join(", ")}` : "";
        print(io, format(), {
          // The drawn board is for the screens (D-336); the CLI's JSON stays what it was.
          json: { added: false, needs: preview.needs, preview: { ...preview, board: undefined, boardProblem: undefined, displayName: undefined } },
          table: `${preview.candidate.name}: ${preview.keyCount} keys${preview.layout ? ` (layout ${preview.layout})` : ""}, main block rows from the top:\n${rows}${controllers}`,
        });
        throw new UsageError(`${preview.candidate.name} is not stored yet. Confirm with ${preview.needs.join(" and ")}${preview.needs.includes("--home-row") ? ` (keyloom guesses ${preview.guessedHomeRow})` : ""}`);
      }
      const out = await withApp((app) => addKeyboard(app, { ...input, ...(opts.force ? { force: true } : {}) }, deps.keyboards));
      print(io, format(), {
        json: {
          added: true, board_id: out.boardId, dir: out.dir, home_row: out.derived.homeRow, thumbs: out.derived.thumbs,
          rows: out.derived.rows.map((r) => ({ name: r.name, keys: r.positions.length })), manual_flash_reason: out.derived.manualFlashReason, warnings: out.warnings,
        },
        ids: [out.boardId],
        table: quiet()
          ? out.boardId
          : [
              `${out.boardId}: stored in ${out.dir}`,
              `rows from the top: ${out.derived.rows.map((r) => `${r.name} ${r.positions.length}`).join(", ")}; thumbs: ${out.derived.thumbs.length}`,
              out.derived.manualFlashReason ? `flashing is manual: ${out.derived.manualFlashReason}` : "",
              ...out.warnings.map((w) => `warning: ${w}`),
              `check it with: keyloom boards show ${out.boardId}`,
              `put a config on it with: keyloom keyboard put <layout> --on ${out.boardId}`,
            ].filter(Boolean).join("\n"),
      });
    });

  keyboard
    .command("put")
    .description("map a layout onto a board and propose it on a new config there; nothing is applied, built or flashed")
    .argument("<layout>", "the layout (config) to copy, by ID or name")
    .requiredOption("--on <board>", "the board to put it on, such as local/corne")
    .option("--name <name>", "the new config's name (default: <layout> on <board>)")
    .option("--placements <pairs...>", "layer key placements, as source=target (e.g. 4=10 5=11)")
    .option("--layers <layers...>", "source layers to carry (default: all non-test layers)")
    .action(async (layout: string, opts: { on: string; name?: string; placements?: string[]; layers?: string[] }) => {
      const placements = opts.placements === undefined ? undefined : parsePlacements(opts.placements);
      let layers: string[] | undefined;
      if (opts.layers) {
        layers = opts.layers.flatMap((l) => l.split(/[,\s]+/)).filter(Boolean);
      }
      const out = await withApp((app) => putConfig(app, {
        from: layout,
        board: opts.on,
        ...(opts.name === undefined ? {} : { name: opts.name }),
        ...(placements === undefined ? {} : { placements }),
        ...(layers === undefined ? {} : { layers }),
      }));
      print(io, format(), {
        json: {
          config: configJson(out.config),
          proposals: out.proposals.map((p) => ({ change_set_id: p.changeSetId, title: p.title, summary: p.summary, warnings: p.warnings, changed_keys: p.changedKeys })),
          placements: out.placements.map((p) => ({ layer: p.layerName, source_position: p.source, key: p.sourceName, blocked: p.blocked ?? null, candidates: p.candidates.map((c) => ({ position: c.target, place: c.name, replaces: c.replaces ?? null })) })),
          layers: out.layers.map((l) => ({ source: l.source, target: l.target, carried: l.carried, guessed: l.guessed, not_carried: l.notCarried })),
          not_carried: out.notCarried.map((n) => ({ layer: n.layerName, source_position: n.source, key: n.sourceName, why: n.why })),
          combos: out.combos,
          notes: out.notes,
        },
        ids: out.proposals.map((p) => p.changeSetId),
        table: quiet()
          ? out.config.id
          : [
              `${out.config.id}  ${out.config.name}`,
              ...out.proposals.map((p) => `proposed ${p.changeSetId}: ${p.title}\n  ${p.summary}`),
              ...transferReportText(out.report, { continues: false }),
              `review: keyloom change show ${out.proposals[0]?.changeSetId}   apply: keyloom change apply ${out.proposals[0]?.changeSetId}`,
              "nothing was applied, built or flashed",
            ].join("\n"),
      });
    });
}
