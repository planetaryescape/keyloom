// Which emulator runs which firmware (10#emulate-prints-what-a-layout-types-for-a-sequence-of-key-presses).
import type { Emulator } from "../firmware/emulate/emulator.ts";
import { emulateQmk } from "../firmware/qmk/emulate.ts";
import { emulateZmk } from "../firmware/zmk/emulate.ts";

// The QMK harness keeps its own per-run folder inside the checkout (D-081), so the app's work and image
// folders aren't needed; it takes the generated source the app already made.
const qmk: Emulator = (input) =>
  emulateQmk({
    board: input.board,
    boardRevisionId: input.boardRevision,
    source: input.source,
    checkoutDir: input.checkoutDir,
    events: [...input.events],
    ...(input.leadMs === undefined ? {} : { leadMs: input.leadMs }),
    log: input.log,
    ...(input.onLine ? { onLine: input.onLine } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });

export const EMULATORS: Record<"qmk" | "zmk", Emulator | undefined> = {
  qmk,
  zmk: emulateZmk,
};
