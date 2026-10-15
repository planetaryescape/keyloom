// Which emulator runs which firmware (10#emulate-prints-what-a-layout-types-for-a-sequence-of-key-presses). A firmware without one says so; the orchestrator fills
// the slot when the QMK emulator lands.
import type { Emulator } from "../firmware/emulate/emulator.ts";
import { emulateZmk } from "../firmware/zmk/emulate.ts";

export const EMULATORS: Record<"qmk" | "zmk", Emulator | undefined> = {
  qmk: undefined,
  zmk: emulateZmk,
};
