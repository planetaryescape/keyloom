// A board definition assembled from what the firmware tree says and what the person confirmed (22#building-the-board-definition).
// Geometry gives hands, thumbs, fingers, rows and mirror pairs (heuristics.ts); the bootloader gives the flash recipe
// (flash-recipe.ts); the home row is the one thing the person has to say. The result goes through the same checks as a
// contributed board (`keyloom boards check`), which the caller runs. Pure.
import type { BoardDefinition, BoardRevision, Geometry, GeometryKey } from "../schema.ts";
import type { Candidate } from "./detect.ts";
import { qmkFlash, targetId, zmkFlash, zmkControllersWithBootDrive } from "./flash-recipe.ts";
import { deriveFingers, deriveHands, deriveMirror, deriveRowGroups, guessHomeRow, rowNames } from "./heuristics.ts";
import { PINNED_SOURCES, QMK_IMAGE, ZMK_IMAGE } from "./pins.ts";

export class DeriveError extends Error {
  override name = "DeriveError";
}

export type DerivedBoard = {
  definition: BoardDefinition;
  geometry: Geometry;
  /** What the person was asked to confirm and what was worked out for them, for the screen or CLI to show. */
  summary: {
    rows: Array<{ name: string; positions: number[] }>;
    thumbs: number[];
    homeRow: number;
    /** What `--home-row` would be if the person had not given one. */
    guessedHomeRow: number;
    manualFlashReason: string | null;
  };
};

export type SourceGeometry = {
  keys: GeometryKey[];
  /** The file the keys came from, as `board.json` names it: a `keyboard.json`, or `file#label` for ZMK. */
  path: string;
};

export type DeriveInput = {
  candidate: Candidate;
  geometry: SourceGeometry;
  /** 1-based, counted from the top row of the main block. */
  homeRow: number;
  /** QMK: the layout macro keymaps are written with. */
  layout?: string;
  /** ZMK: the controller board a shield runs on (`nice_nano//zmk`). */
  controller?: string;
};

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "keyboard";

/** The id a derived board gets: `local/` keeps it apart from the boards keyloom ships (`foostan/corne`), and the folder it is stored in is this path. */
export const localBoardId = (c: Candidate): string => `local/${slug(c.entry.kind === "qmk" ? c.entry.qmk.target : c.entry.zmk.id)}`;

// Submodules a QMK build needs by platform (qmk_firmware .gitmodules): LUFA for AVR, ChibiOS for ARM, and the Pico SDK on top for the RP2040.
// Taken from the platform's bootloader, not a measured build: the first smoke build of a derived board will confirm or correct them (22).
function qmkSubmodules(bootloader: string | undefined): string[] {
  if (bootloader === "rp2040") return ["lib/chibios", "lib/chibios-contrib", "lib/printf", "lib/pico-sdk"];
  const avr = ["atmel-dfu", "qmk-dfu", "lufa-dfu", "caterina", "halfkay", "lufa-ms"];
  if (bootloader !== undefined && avr.includes(bootloader)) return ["lib/lufa"];
  if (bootloader === "usbasploader" || bootloader === "bootloadhid") return ["lib/vusb"];
  return ["lib/chibios", "lib/chibios-contrib", "lib/printf"];
}

function revisionFor(input: DeriveInput): { revision: BoardRevision; manualFlashReason: string | null } {
  const { candidate: c } = input;
  if (c.entry.kind === "qmk") {
    const e = c.entry.qmk;
    if (input.layout === undefined) throw new DeriveError("a QMK board needs the layout macro its keymaps are written with");
    const { flash, artifact, manualReason } = qmkFlash(e.bootloader, e.bootInstructions);
    return {
      manualFlashReason: manualReason ?? null,
      revision: {
        id: "default",
        source: { repo: PINNED_SOURCES.qmk.repo, ref: "master", sha: PINNED_SOURCES.qmk.sha },
        qmkTarget: e.target,
        build: {
          kind: "qmk-docker", image: QMK_IMAGE, layoutMacro: input.layout, keymapsDir: `keyboards/${e.target}/keymaps`, submodules: qmkSubmodules(e.bootloader),
          layoutFile: input.geometry.path, artifact,
        },
        flash,
        detect: { usbProductId: e.pid, usbVendorId: e.vid },
      },
    };
  }
  const e = c.entry.zmk;
  if (e.requires && e.requires.length > 0 && input.controller === undefined) {
    throw new DeriveError(`${e.name} needs a controller board that provides ${e.requires.join(", ")}; choose one with --controller. Ones keyloom knows the boot drive of: ${zmkControllersWithBootDrive().join(", ")}`);
  }
  const controller = input.controller ?? e.siblings[0] ?? e.id;
  const flash = zmkFlash(controller, e.siblings);
  if (flash === undefined) {
    throw new DeriveError(`keyloom doesn't know the name of ${controller}'s boot drive, so it can't write the flash steps. Ones it does: ${zmkControllersWithBootDrive().join(", ")}`);
  }
  const split = e.siblings.length > 1;
  const nice = controller === "nice_nano//zmk" && split && flash.kind === "uf2-drives";
  // Hands-free flashing is the keyloom-zmk module's, which is proven on the nice!nano (D-095); every other controller is flashed by hand until it is.
  const withHandsFree: typeof flash = nice
    ? {
        ...flash,
        handsFree: {
          trigger: "cdc-1200",
          halves: flash.steps.map((s, i) => ({ role: i === 0 ? "central" : "peripheral", step: s.label, marker: i === 0 ? "L" : "R", ...(i === 0 ? {} : { relay: true }) })),
          serialMarker: "usb-sn-override",
          serialTail: ":0123456789ABCDEF",
        },
      }
    : flash;
  return {
    manualFlashReason: null,
    revision: {
      id: "default",
      source: { repo: PINNED_SOURCES.zmk.repo, ref: "main", sha: PINNED_SOURCES.zmk.sha },
      build: {
        kind: "zmk-west-docker", image: ZMK_IMAGE, board: controller, keymapName: e.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_"), physicalLayout: input.geometry.path,
        targets: e.siblings.map((s) => ({ id: targetId(s), shield: s })),
      },
      flash: withHandsFree,
      detect: null,
    },
  };
}

export function deriveBoard(input: DeriveInput): DerivedBoard {
  const { candidate: c, geometry } = input;
  const keys = geometry.keys;
  const hands = deriveHands(keys);
  if (hands.left.length === 0 || hands.right.length === 0) throw new DeriveError("the layout has no gap between two halves, so keyloom can't tell the hands apart");
  const found = deriveFingers(keys, hands);
  const groups = deriveRowGroups(keys, found);
  if (input.homeRow < 1 || input.homeRow > groups.length) {
    throw new DeriveError(`home row ${input.homeRow} isn't one of this board's ${groups.length} rows; count from the top row, 1 to ${groups.length}`);
  }
  const names = rowNames(groups.length, input.homeRow);
  const rowOf = new Map(groups.flatMap((g, i) => g.map((p) => [p, names[i] as string] as const)));
  const { revision, manualFlashReason } = revisionFor(input);

  const rows: Record<string, number[]> = Object.fromEntries(groups.map((g, i) => [names[i] as string, g]));
  if (found.thumbs.length > 0) rows.thumb = found.thumbs;

  const name = c.name;
  const definition: BoardDefinition = {
    schemaVersion: 1,
    id: localBoardId(c),
    name,
    vendor: c.vendor,
    firmware: c.firmware,
    keyCount: keys.length,
    revisions: [revision],
    hands,
    fingers: found.fingers,
    rows,
    mirror: deriveMirror(keys, hands, found.fingers, rowOf),
    importers: [c.firmware === "qmk" ? "qmk-keymap" : "zmk-keymap"],
  };
  const source = revision.source;
  return {
    definition,
    geometry: { schemaVersion: 1, source: { repo: source.repo, sha: source.sha, path: geometry.path }, keys },
    summary: {
      rows: groups.map((positions, i) => ({ name: names[i] as string, positions })),
      thumbs: found.thumbs,
      homeRow: input.homeRow,
      guessedHomeRow: guessHomeRow(groups.length),
      manualFlashReason,
    },
  };
}

/** The rows a candidate's geometry would have, so the person can be shown them before choosing the home row. */
export function previewRows(keys: readonly GeometryKey[]): { rows: number[][]; guessedHomeRow: number } {
  const found = deriveFingers(keys, deriveHands(keys));
  const rows = deriveRowGroups(keys, found);
  return { rows, guessedHomeRow: guessHomeRow(rows.length) };
}
