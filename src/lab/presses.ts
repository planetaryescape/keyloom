// A trace as presses: a key going down and coming up again.
import type { EmulatorEvent } from "../firmware/emulate/types.ts";

export type Press = {
  /** Order of the press in the trace, from 0. It names the press in every comparison between a recording and a replay. */
  index: number;
  position: number;
  downAt: number;
  /** When the key came up; the end of the trace for a key still down then. */
  upAt: number;
};

export function pressesOf(events: readonly EmulatorEvent[]): Press[] {
  const presses: Press[] = [];
  const open = new Map<number, Press>();
  const end = events.at(-1)?.at ?? 0;
  for (const e of events) {
    if (e.action === "press") {
      const press: Press = { index: presses.length, position: e.position, downAt: e.at, upAt: end };
      presses.push(press);
      open.set(e.position, press);
    } else {
      const press = open.get(e.position);
      if (press) {
        press.upAt = e.at;
        open.delete(e.position);
      }
    }
  }
  return presses;
}
