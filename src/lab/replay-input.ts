// A recorded trace in the shape the emulators take (D-282): in time order, starting at 0, whole milliseconds, with long pauses
// shortened. Everything downstream (the presses the analysis reads, the events an emulator is given) comes from this one
// list, so the times the classifier compares with an emulator's reports are the times the emulator saw.
import type { EmulatorEvent } from "../firmware/emulate/types.ts";
import type { TraceEvent } from "../firmware/emulate/trace.ts";

/**
 * A pause longer than this is shortened to it. No tap-hold decision looks back further than a few hundred milliseconds,
 * and ZMK's emulator cannot wait more than 32 seconds between two events.
 */
export const MAX_GAP_MS = 3000;

export function prepareEvents(events: readonly TraceEvent[], maxGapMs = MAX_GAP_MS): EmulatorEvent[] {
  // Array.prototype.sort is stable, so events the keyboard reported in one millisecond keep their reported order.
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const first = sorted[0];
  if (first === undefined) return [];
  let shortened = 0;
  let previous = first.at;
  return sorted.map((e) => {
    if (e.at - previous > maxGapMs) shortened += e.at - previous - maxGapMs;
    previous = e.at;
    return { at: Math.round(e.at - first.at - shortened), position: e.position, action: e.action };
  });
}
