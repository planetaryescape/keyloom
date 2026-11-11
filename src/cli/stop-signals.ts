// How a terminal stops keyloom: Ctrl-C (SIGINT), a closed terminal (SIGHUP) or a kill (SIGTERM). The first asks the work to stop.
// While a keyboard write is under way no signal ends keyloom: the flash tools run in their own process group, so the terminal's
// Ctrl-C never reaches them, and keyloom stays up to see the write through (D-506). With no write under way, a second signal ends
// keyloom at once, as it always has, which is the way out of a stop that hangs.
import { WRITE_IN_PROGRESS_MESSAGE, keyboardWriteInProgress } from "../app/index.ts";

export const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** Calls `onStop` on the first stop signal. Returns the function that removes the handlers. */
export function catchStopSignals(onStop: () => void, say: (text: string) => void = (text) => void process.stderr.write(text)): () => void {
  let stopping = false;
  const handler = (signal: NodeJS.Signals) => {
    const writing = keyboardWriteInProgress();
    if (writing) say(`${WRITE_IN_PROGRESS_MESSAGE}\n`);
    if (!stopping) {
      stopping = true;
      onStop();
      return;
    }
    if (writing) return;
    dispose();
    // Raised again with no handler left, so keyloom ends the way the signal ends any process.
    process.kill(process.pid, signal);
  };
  const dispose = () => {
    for (const signal of STOP_SIGNALS) process.off(signal, handler);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, handler);
  return dispose;
}
