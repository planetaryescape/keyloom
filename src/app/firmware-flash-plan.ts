// What a flash of a board will need, known before anyone clicks Flash (D-489, D-490): whether keyloom can flash it
// at all, and which tool the flash runs. The release dialog reads it from the build, so a missing Zapp is an Install
// button before the flash, and a board keyloom can't flash gets its file instead of a Flash button that always fails.
import type { Board } from "../boards/load.ts";
import { qmkRevision } from "../firmware/qmk/board-config.ts";
import type { DfuTool } from "../firmware/qmk/dfu-flash.ts";
import { findTool } from "../firmware/toolchain/kept-tools.ts";
import { type InstallableTool, TOOL_PAGES, canInstall, downloadsHere } from "./tool-install.ts";

/** `canDownload`: no Homebrew, and keyloom can fetch the tool's pinned release itself (Zapp only, D-561). */
export type FlashTool = { name: InstallableTool; installed: boolean; canInstall: boolean; canDownload: boolean; url: string };

export type FlashPlan = {
  /** The board's own steps when keyloom can't flash it; null when keyloom flashes it. */
  manual: string | null;
  /** The tool the flash runs, and whether it is on this computer; null when the flash needs none (UF2 drives). */
  tool: FlashTool | null;
  /** Whether keyloom can show the firmware file in Finder: macOS only. */
  canReveal: boolean;
};

export type FlashPlanDeps = {
  has?: (command: string) => boolean;
  platform?: NodeJS.Platform;
  arch?: string | undefined;
  /** DFU tools a test or caller points at directly, in place of the ones on PATH. */
  dfuTools?: Partial<Record<DfuTool, string>>;
};

export function flashPlanFor(board: Board, boardRevision: string, deps: FlashPlanDeps = {}): FlashPlan {
  // On PATH, or in keyloom's own folder where Get Zapp keeps it (D-561); the flash runs the same one.
  const has = deps.has ?? ((command: string) => findTool(command) !== undefined);
  const platform = deps.platform ?? process.platform;
  const canReveal = platform === "darwin";
  // ZMK boards flash by copying to their boot drives, and a kanata board is never flashed: no tool either way.
  if (board.definition.firmware !== "qmk") return { manual: null, tool: null, canReveal };
  const flash = qmkRevision(board.definition, boardRevision).flash;
  if (flash.kind === "manual") return { manual: flash.instructions, tool: null, canReveal };
  if (flash.kind === "uf2-drives") return { manual: null, tool: null, canReveal };
  const name: InstallableTool = flash.kind === "zapp" ? "zapp" : flash.tool;
  const given = flash.kind === "dfu-tool" ? deps.dfuTools?.[flash.tool] : undefined;
  return {
    manual: null,
    tool: {
      name, installed: given !== undefined || has(name), canInstall: canInstall({ has, platform }),
      canDownload: downloadsHere(name, { has, platform, download: { arch: deps.arch } }),
      url: TOOL_PAGES[name],
    },
    canReveal,
  };
}
