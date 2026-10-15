// What differs between firmware families in generate, build and flash: the app's use cases call
// these, so a ZMK layout goes through the same commands and editor routes as a QMK one (01#modules).
import type { Board } from "../boards/load.ts";
import { artifactKind } from "../firmware/qmk/artifact.ts";
import { qmkRevision } from "../firmware/qmk/board-config.ts";
import { buildQmk } from "../firmware/qmk/build.ts";
import { RESET_INSTRUCTION, flashWithZapp } from "../firmware/qmk/flash.ts";
import { GenerateError as QmkGenerateError, generateQmkSource } from "../firmware/qmk/generate.ts";
import { zmkRevision } from "../firmware/zmk/board-config.ts";
import { buildZmk } from "../firmware/zmk/build.ts";
import { buildZmkWest } from "../firmware/zmk/build-west.ts";
import { BOOTLOADER_WAIT_MS, type FlashStep, flashUf2Drives, instructionFor } from "../firmware/zmk/flash.ts";
import { GenerateError as ZmkGenerateError, generateZmkSource } from "../firmware/zmk/generate.ts";
import { defaultVolumeFinder, volumeFinderAt } from "../firmware/zmk/volumes.ts";
import type { FlashResult, FlashState } from "../firmware/toolchain/flash-state.ts";
import type { LogSink } from "../firmware/toolchain/run.ts";
import type { LayoutView } from "./layouts.ts";

export type GeneratedSource = { keymapName: string; files: Array<{ path: string; content: string }> };

/** The layout can't be written as this firmware's source; `message` says what in it is the problem. */
export class SourceError extends Error {
  override name = "SourceError";
}

export type BuildArgs = {
  view: LayoutView;
  boardRevision: string;
  source: GeneratedSource;
  checkoutDir: string;
  /** Where Docker images for this board are built from. */
  imageContextDir: string;
  artifactPath: string;
  log: LogSink;
  containerName: string;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
};

export type FlashArgs = {
  board: Board;
  boardRevision: string;
  artifactPath: string;
  log: LogSink;
  onState: (state: FlashState, instruction: string | null) => void;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  bootloaderWaitMs?: number;
  /** Where UF2 boot drives appear. Only the Glove80 flow reads it; tests pass a temporary directory. */
  volumesRoot?: string;
};

export type FirmwareDriver = {
  /** How messages name the source: "QMK" or "ZMK". */
  name: string;
  /** `bin`, `hex` or `uf2` for a single firmware file; `zip` for a bundle with one UF2 per half. */
  artifactExtension(board: Board, boardRevision: string): string;
  generate(view: LayoutView, boardRevision: string): GeneratedSource;
  build(args: BuildArgs): Promise<void>;
  flash(args: FlashArgs): Promise<FlashResult>;
  /** What to tell the person about a flash that is waiting, before the flasher has said anything itself. */
  waitingInstruction(board: Board): string;
};

const qmk: FirmwareDriver = {
  name: "QMK",
  artifactExtension: (board, rev) => artifactKind(qmkRevision(board.definition, rev).build),
  waitingInstruction(board) {
    const flash = qmkRevision(board.definition).flash;
    if (flash.kind === "uf2-drives") return instructionFor(flash.steps[0] as FlashStep, 0, flash.steps.length, BOOTLOADER_WAIT_MS);
    return flash.kind === "manual" ? flash.instructions : RESET_INSTRUCTION;
  },
  generate(view, boardRevision) {
    try {
      return generateQmkSource({ layout: view.document, board: view.board.definition, revisionId: view.revision.id, boardRevisionId: boardRevision });
    } catch (err) {
      if (err instanceof QmkGenerateError) throw new SourceError(err.message);
      throw err;
    }
  },
  async build(a) {
    await buildQmk({
      board: a.view.board.definition, boardRevisionId: a.boardRevision, source: a.source, checkoutDir: a.checkoutDir, artifactPath: a.artifactPath,
      log: a.log, containerName: a.containerName, ...(a.onLine ? { onLine: a.onLine } : {}), ...(a.signal ? { signal: a.signal } : {}),
    });
  },
  async flash(a) {
    const flash = qmkRevision(a.board.definition, a.boardRevision).flash;
    if (flash.kind === "manual") {
      const error = `keyloom can't flash ${a.board.definition.name} itself. The firmware file is ${a.artifactPath}. ${flash.instructions}`;
      a.log.line(`keyloom: ${error}`);
      a.onState("failed", null);
      return { state: "failed", error, output: [] };
    }
    if (flash.kind === "uf2-drives") {
      return flashUf2Drives({
        artifactPath: a.artifactPath, steps: flash.steps, shape: "single", driveFileName: "firmware.uf2", log: a.log, onState: a.onState,
        findVolume: a.volumesRoot === undefined ? defaultVolumeFinder() : volumeFinderAt(a.volumesRoot),
        ...(a.onLine ? { onLine: a.onLine } : {}), ...(a.bootloaderWaitMs === undefined ? {} : { bootloaderWaitMs: a.bootloaderWaitMs }),
        ...(a.signal ? { signal: a.signal } : {}),
      });
    }
    return flashWithZapp({
      artifactPath: a.artifactPath, bootloader: flash.bootloader, log: a.log, onState: a.onState,
      ...(a.onLine ? { onLine: a.onLine } : {}), ...(a.bootloaderWaitMs === undefined ? {} : { bootloaderWaitMs: a.bootloaderWaitMs }),
      ...(a.signal ? { signal: a.signal } : {}),
    });
  },
};

const zmk: FirmwareDriver = {
  name: "ZMK",
  artifactExtension: (board) => (zmkRevision(board.definition).build.kind === "zmk-west-docker" ? "zip" : "uf2"),
  // A flash starts at the first step, so that is what the person should be doing until the flasher says otherwise.
  waitingInstruction(board) {
    const steps = zmkRevision(board.definition).flash.steps;
    return instructionFor(steps[0] as FlashStep, 0, steps.length, BOOTLOADER_WAIT_MS);
  },
  generate(view) {
    const build = zmkRevision(view.board.definition).build;
    try {
      return generateZmkSource({
        layout: view.document, board: view.board.definition, geometry: view.board.geometry, revisionId: view.revision.id,
        ...(build.kind === "zmk-west-docker" ? { keymapName: build.keymapName } : {}),
      });
    } catch (err) {
      if (err instanceof ZmkGenerateError) throw new SourceError(err.message);
      throw err;
    }
  },
  async build(a) {
    const build = zmkRevision(a.view.board.definition).build.kind === "zmk-west-docker" ? buildZmkWest : buildZmk;
    await build({
      board: a.view.board.definition, source: a.source, checkoutDir: a.checkoutDir, imageContextDir: a.imageContextDir, artifactPath: a.artifactPath,
      log: a.log, containerName: a.containerName, ...(a.onLine ? { onLine: a.onLine } : {}), ...(a.signal ? { signal: a.signal } : {}),
    });
  },
  flash(a) {
    return flashUf2Drives({
      artifactPath: a.artifactPath, steps: zmkRevision(a.board.definition, a.boardRevision).flash.steps,
      // The Glove80's one file holds both halves; a west build's bundle holds one image per half.
      ...(zmkRevision(a.board.definition).build.kind === "zmk-moergo-template" ? { driveFileName: "glove80.uf2" } : { driveFileName: "firmware.uf2" }), log: a.log, onState: a.onState,
      // Without a root the real machine's mount root is used, which a test's preload refuses (test/helpers/no-real-flash.ts).
      findVolume: a.volumesRoot === undefined ? defaultVolumeFinder() : volumeFinderAt(a.volumesRoot),
      ...(a.onLine ? { onLine: a.onLine } : {}), ...(a.bootloaderWaitMs === undefined ? {} : { bootloaderWaitMs: a.bootloaderWaitMs }),
      ...(a.signal ? { signal: a.signal } : {}),
    });
  },
};

export const driverFor = (board: Board): FirmwareDriver => (board.definition.firmware === "zmk" ? zmk : qmk);
