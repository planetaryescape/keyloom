// What differs between firmware families in generate, build and flash: the app's use cases call
// these, so a ZMK layout goes through the same commands and editor routes as a QMK one (01#modules).
import type { Board } from "../boards/load.ts";
import { artifactKind } from "../firmware/qmk/artifact.ts";
import { qmkRevision } from "../firmware/qmk/board-config.ts";
import { buildQmk } from "../firmware/qmk/build.ts";
import { CHECKING_INSTRUCTION, flashWithZapp, resetInstruction } from "../firmware/qmk/flash.ts";
import { type HandsFreeDeps, handsFreeHooks, keyboardTarget, realHandsFreeDeps } from "../firmware/qmk/handsfree-flash.ts";
import { GenerateError as QmkGenerateError, generateQmkSource } from "../firmware/qmk/generate.ts";
import { zmkRevision } from "../firmware/zmk/board-config.ts";
import { type ZmkHandsFreeDeps, realZmkHandsFreeDeps, zmkHandsFreeHooks } from "../firmware/zmk/handsfree-flash.ts";
import { buildZmk } from "../firmware/zmk/build.ts";
import { buildZmkWest } from "../firmware/zmk/build-west.ts";
import { BOOTLOADER_WAIT_MS, type FlashStep, ZMK_CHECKING_INSTRUCTION, flashUf2Drives, instructionFor } from "../firmware/zmk/flash.ts";
import { GenerateError as ZmkGenerateError, generateZmkSource } from "../firmware/zmk/generate.ts";
import { defaultVolumeFinder, volumeFinderAt } from "../firmware/zmk/volumes.ts";
import type { FlashNote, FlashResult, FlashState } from "../firmware/toolchain/flash-state.ts";
import type { LogSink } from "../firmware/toolchain/run.ts";
import { portOfAnotherBoard } from "./zmk-ports.ts";
import type { RemapperOverrides } from "./remapper.ts";
import { GenerateError as KanataGenerateError, generateKanataSource } from "../firmware/kanata/generate.ts";
import type { LayoutView } from "./layouts.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

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

/** How a keyboard is found and restarted: USB and raw HID for a ZSA board, serial ports for a ZMK one. Tests pass fakes; otherwise the machine's own are used. */
export type HandsFreeOverrides = Partial<HandsFreeDeps> & { zmk?: Partial<ZmkHandsFreeDeps>; remapper?: RemapperOverrides };

export type FlashArgs = {
  board: Board;
  boardRevision: string;
  /** The build being flashed; a hands-free flash checks the keyboard comes back running it. */
  buildId: string;
  artifactPath: string;
  log: LogSink;
  onState: (state: FlashState, instruction: string | null, note?: FlashNote) => void;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  bootloaderWaitMs?: number;
  /** Where UF2 boot drives appear. Only the Glove80 flow reads it; tests pass a temporary directory. */
  volumesRoot?: string;
  handsFree?: HandsFreeOverrides;
  /** Where the last image that was flashed and verified is kept, per board and half; nothing is kept without it. */
  lastGoodDir?: string;
};

export type FirmwareDriver = {
  /** How messages name the source: "QMK" or "ZMK". */
  name: string;
  /** `bin`, `hex` or `uf2` for a single firmware file; `zip` for a bundle with one UF2 per half. */
  artifactExtension(board: Board, boardRevision: string): string;
  /** `buildId`, when the source is for a build, lets the firmware carry that build's marker (D-070). */
  generate(view: LayoutView, boardRevision: string, buildId?: string): GeneratedSource;
  build(args: BuildArgs): Promise<void>;
  flash(args: FlashArgs): Promise<FlashResult>;
  /** What to tell the person about a flash that is waiting, before the flasher has said anything itself. */
  /** What to do before the flasher has said anything; `waitMs` is how long this flash will wait, when it was asked for. */
  waitingInstruction(board: Board, waitMs?: number): string;
};

const qmk: FirmwareDriver = {
  name: "QMK",
  artifactExtension: (board, rev) => artifactKind(qmkRevision(board.definition, rev).build),
  waitingInstruction(board, waitMs = BOOTLOADER_WAIT_MS) {
    const flash = qmkRevision(board.definition).flash;
    if (flash.kind === "uf2-drives") return instructionFor(flash.steps[0] as FlashStep, 0, flash.steps.length, waitMs);
    if (flash.kind === "manual") return flash.instructions;
    // Until the flasher has looked at the keyboard, the person can't be told to press anything: if it runs keyloom's
    // firmware there is nothing to press (D-070), and a wrong "press reset" for the few seconds it takes to look is worse than none.
    return keyboardTarget(board.definition, qmkRevision(board.definition)) ? CHECKING_INSTRUCTION : resetInstruction(waitMs);
  },
  generate(view, boardRevision, buildId) {
    const rev = qmkRevision(view.board.definition, boardRevision);
    try {
      return generateQmkSource({
        layout: view.document, board: view.board.definition, revisionId: view.revision.id, boardRevisionId: boardRevision,
        // Only a ZSA board flashed by Zapp has the Oryx raw-HID endpoint the bootloader command rides on.
        ...(buildId !== undefined && view.board.definition.vendor === "ZSA" && rev.flash.kind === "zapp" ? { handsFree: { buildId } } : {}),
      });
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
    const rev = qmkRevision(a.board.definition, a.boardRevision);
    const hooks = await handsFreeHooks({
      deps: realHandsFreeDeps(a.handsFree), board: a.board.definition, rev, buildId: a.buildId, log: a.log,
      artifact: new Uint8Array(await Bun.file(a.artifactPath).arrayBuffer().catch(() => new ArrayBuffer(0))),
    });
    // The same last good image the ZMK flash keeps, for the same reason: only an image the keyboard was seen to run (D-165).
    const verify = hooks.verify;
    const keep = a.lastGoodDir;
    const keepingVerify: typeof verify =
      verify && keep !== undefined
        ? async () => {
            const result = await verify();
            if (result.ok) {
              try {
                const dir = join(keep, a.board.definition.id.replace("/", "-"));
                await mkdir(dir, { recursive: true });
                await Bun.write(join(dir, `${a.boardRevision}.${artifactKind(rev.build)}`), Bun.file(a.artifactPath));
              } catch (err) {
                a.log.line(`keyloom: couldn't keep this image as the last good one: ${(err as Error).message}`);
              }
            }
            return result;
          }
        : verify;
    return flashWithZapp({
      ...hooks,
      ...(keepingVerify ? { verify: keepingVerify } : {}),
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
  waitingInstruction(board, waitMs = BOOTLOADER_WAIT_MS) {
    const flash = zmkRevision(board.definition).flash;
    // Until the flasher has looked at the serial ports the person can't be told to press anything: if the halves run keyloom's firmware there is nothing to press.
    if (flash.handsFree) return ZMK_CHECKING_INSTRUCTION;
    const steps = flash.steps;
    return instructionFor(steps[0] as FlashStep, 0, steps.length, waitMs);
  },
  generate(view, boardRevision, buildId) {
    const rev = zmkRevision(view.board.definition, boardRevision);
    const build = rev.build;
    try {
      return generateZmkSource({
        layout: view.document, board: view.board.definition, geometry: view.board.geometry, revisionId: view.revision.id,
        ...(build.kind === "zmk-west-docker" ? { keymapName: build.keymapName } : {}),
        ...(buildId !== undefined && rev.flash.handsFree ? { handsFree: { buildId, config: rev.flash.handsFree } } : {}),
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
  async flash(a) {
    const rev = zmkRevision(a.board.definition, a.boardRevision);
    // Without a root the real machine's mount root is used, which a test's preload refuses (test/helpers/no-real-flash.ts).
    const findVolume = a.volumesRoot === undefined ? defaultVolumeFinder() : volumeFinderAt(a.volumesRoot);
    const handsFree = rev.flash.handsFree;
    const hooks = handsFree
      ? zmkHandsFreeHooks({
          deps: realZmkHandsFreeDeps(a.handsFree?.zmk), board: a.board.definition, handsFree, steps: rev.flash.steps, buildId: a.buildId, findVolume, foreign: portOfAnotherBoard(a.board.definition.id),
          artifact: new Uint8Array(await Bun.file(a.artifactPath).arrayBuffer().catch(() => new ArrayBuffer(0))), log: (line) => a.log.line(line),
          ...(a.lastGoodDir === undefined ? {} : { saveLastGood: async (half, image) => {
            const dir = join(a.lastGoodDir as string, a.board.definition.id.replace("/", "-"));
            await mkdir(dir, { recursive: true });
            await Bun.write(join(dir, `${half}.uf2`), image);
          } }),
        })
      : undefined;
    return flashUf2Drives({
      artifactPath: a.artifactPath, steps: rev.flash.steps,
      // The Glove80's one file holds both halves; a west build's bundle holds one image per half.
      ...(rev.build.kind === "zmk-moergo-template" ? { driveFileName: "glove80.uf2" } : { driveFileName: "firmware.uf2" }), log: a.log, onState: a.onState,
      findVolume, ...(hooks ? { hooks } : {}),
      ...(a.onLine ? { onLine: a.onLine } : {}), ...(a.bootloaderWaitMs === undefined ? {} : { bootloaderWaitMs: a.bootloaderWaitMs }),
      ...(a.signal ? { signal: a.signal } : {}),
    });
  },
};

// A software remapper has no build and no flash (21): `generate` writes the config files, and applying is the remapper use cases in remapper.ts.
const kanata: FirmwareDriver = {
  name: "kanata",
  artifactExtension: () => "kbd",
  waitingInstruction: () => "",
  generate(view) {
    try {
      const out = generateKanataSource({ layout: view.document, board: view.board.definition, layoutId: view.layout.id, revisionId: view.revision.id });
      return { keymapName: "keyloom", files: out.files };
    } catch (err) {
      if (err instanceof KanataGenerateError) throw new SourceError(err.message);
      throw err;
    }
  },
  async build() {
    throw new SourceError("a kanata board isn't built; applying writes its config and reloads it (`keyloom sync`)");
  },
  async flash() {
    throw new SourceError("a kanata board isn't flashed; applying writes its config and reloads it (`keyloom sync`)");
  },
};

export const driverFor = (board: Board): FirmwareDriver => (board.definition.firmware === "zmk" ? zmk : board.definition.firmware === "kanata" ? kanata : qmk);
