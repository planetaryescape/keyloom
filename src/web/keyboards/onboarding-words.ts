// What the first-run screens say about writing to a keyboard, by its firmware (R7-13). A USB keyboard is flashed, and never from setup;
// the MacBook's own keyboard is never flashed: keyloom loads its config into kanata, and only when a change is applied.

import type { BoardChoice } from "../../api/http.ts";

type Firmware = BoardChoice["firmware"];

/**
 * The welcome's line under its heading. `chosen`: the firmware of the board being set up, or null before one is picked or for a keyboard
 * keyloom hasn't met. `listed`: the list of keyboards shows below; while a keyboard is being set up it doesn't, so "choose it below"
 * would point at nothing (R10-04).
 */
export function welcomeLead(chosen: Firmware | null, listed: boolean = chosen === null): string {
  if (chosen === "kanata") return "keyloom remaps your MacBook's own keyboard through kanata. Setup changes nothing on this Mac.";
  if (listed) return "Connect a keyboard or choose it below. Setup never changes a keyboard.";
  return "Setup never flashes your keyboard.";
}

/** The end of the setup card's lead: when a change first reaches the keyboard. */
export const setupWrites = (firmware: Firmware | undefined): string =>
  firmware === "kanata" ? "Nothing changes on your MacBook until you apply a change." : "Nothing is written to the keyboard until you apply a change.";

/** The setup card's footer. `plugged`: the card opened because the keyboard was plugged in, so keyloom read it over USB. */
export function setupFoot(firmware: Firmware | undefined, plugged: boolean): string {
  if (firmware === "kanata") return "Nothing changes on your MacBook from here. Your changes reach it through kanata, which keyloom helps you set up.";
  return plugged ? "keyloom only reads the keyboard. Nothing is written to it." : "Nothing is written to the keyboard from here.";
}
