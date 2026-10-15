// What an emulator is given by the app, whichever firmware it runs. The app generates the same source a
// build would use, parses the key script into events, and hands both over; the emulator does the rest.
import type { BoardDefinition } from "../../boards/schema.ts";
import type { LogSink } from "../toolchain/run.ts";
import type { EmulationResult, EmulatorEvent } from "./types.ts";

export type EmulatorInput = {
  board: BoardDefinition;
  boardRevision: string;
  /** The source keyloom generated for this layout, as a build would use it. */
  source: { keymapName: string; files: Array<{ path: string; content: string }> };
  events: readonly EmulatorEvent[];
  /** The board's pinned checkout folder, the one builds use; it must be under a folder Docker can mount. */
  checkoutDir: string;
  /** Where the emulator keeps its inputs and build output, so a repeat run builds incrementally. */
  workDir: string;
  /** Where Docker images for this board are built from. */
  imageContextDir: string;
  log: LogSink;
  /** Docker container name, so a timeout can remove the container as well as the docker client. */
  containerName: string;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type Emulator = (input: EmulatorInput) => Promise<EmulationResult>;
