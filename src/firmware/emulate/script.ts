// The little language `keyloom emulate` reads key presses in: "hold 31 300 then tap 32". Keys are numbered
// the way the editor and the agent number them (position + 1), so the number you see on a key is the one
// you type here.
import type { EmulatorEvent } from "./types.ts";

export class ScriptError extends Error {
  override name = "ScriptError";
}

/** How long a tap keeps the key down. Long enough for any debounce, short enough to stay under a tapping term. */
export const TAP_MS = 40;
/** The pause after a tap, so two taps in a row are two separate presses. */
export const GAP_MS = 20;
/** How long `hold 31` waits before the next step when no time is given: past the usual tapping terms (200 to 300 ms). */
export const HOLD_MS = 400;

export const SCRIPT_HELP = [
  "Steps are separated by `then`, `;` or new lines; `#` starts a comment in a script file. Keys are numbered as in the editor.",
  "  tap 31         press key 31 and let go",
  "  tap 31+32      press both together and let go together (a chord or combo)",
  "  hold 31 [ms]   press key 31 and keep it down; the next step starts ms later (default 400)",
  "  release 31     let go of a held key (keys still down at the end are released for you)",
  "  wait 200       let 200 ms pass",
  "  @500 tap 31    start that step at 500 ms instead of right after the previous one",
  'Example: "hold 31 300 then tap 32" holds key 31 for 300 ms, taps key 32 while it is down, then lets go of 31.',
].join("\n");

type Clock = { t: number; down: number[] };

function keyNumber(text: string, step: string, keyCount: number | undefined): number {
  if (!/^\d+$/.test(text)) throw new ScriptError(`"${text}" is not a key number in "${step}"; keys are numbered from 1, as in the editor`);
  const n = Number(text);
  if (n < 1 || (keyCount !== undefined && n > keyCount)) {
    throw new ScriptError(`there is no key ${n} in "${step}"${keyCount === undefined ? "" : `; this board has keys 1 to ${keyCount}`}`);
  }
  return n - 1;
}

function milliseconds(text: string | undefined, fallback: number | undefined, step: string): number {
  if (text === undefined) {
    if (fallback === undefined) throw new ScriptError(`"${step}" needs a time in milliseconds`);
    return fallback;
  }
  if (!/^\d+$/.test(text)) throw new ScriptError(`"${text}" is not a number of milliseconds in "${step}"`);
  return Number(text);
}

function splitSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, ""))
    .flatMap((line) => line.split(/;|\bthen\b/i))
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * A script to key events, with times in ms from the start. `keyCount` makes a key number past the end of the
 * board an error here, with the board's range, instead of a mystery later.
 */
export function parseScript(text: string, opts: { keyCount?: number } = {}): EmulatorEvent[] {
  const events: EmulatorEvent[] = [];
  const clock: Clock = { t: 0, down: [] };
  const emit = (at: number, position: number, action: EmulatorEvent["action"]) => events.push({ at, position, action });

  for (const step of splitSteps(text)) {
    const words = step.split(/\s+/);
    let verb = words.shift() as string;
    if (verb.startsWith("@")) {
      const at = milliseconds(verb.slice(1), undefined, step);
      if (at < clock.t) throw new ScriptError(`"${step}" starts at ${at} ms, but the script is already at ${clock.t} ms`);
      clock.t = at;
      verb = words.shift() ?? "";
      if (verb === "") throw new ScriptError(`"${step}" has a time but no action`);
    }
    const keys = (arg: string | undefined) => (arg ?? "").split("+").map((k) => keyNumber(k, step, opts.keyCount));
    switch (verb.toLowerCase()) {
      case "tap": {
        if (words.length !== 1) throw new ScriptError(`"${step}": tap takes one key or a chord like 31+32; for two taps in a row write "tap 31 then tap 32"`);
        const chord = keys(words[0]);
        for (const p of chord) pressKey(p, clock, step, emit);
        const upAt = clock.t + TAP_MS;
        for (const p of chord) releaseKey(p, upAt, clock, step, emit);
        clock.t = upAt + GAP_MS;
        break;
      }
      case "hold": {
        if (words.length < 1 || words.length > 2) throw new ScriptError(`"${step}": hold takes a key and optionally a time, like "hold 31 300"`);
        for (const p of keys(words[0])) pressKey(p, clock, step, emit);
        clock.t += milliseconds(words[1], HOLD_MS, step);
        break;
      }
      case "release": {
        if (words.length !== 1) throw new ScriptError(`"${step}": release takes one key`);
        for (const p of keys(words[0])) releaseKey(p, clock.t, clock, step, emit);
        break;
      }
      case "wait": {
        if (words.length !== 1) throw new ScriptError(`"${step}": wait takes a time in milliseconds`);
        clock.t += milliseconds(words[0], undefined, step);
        break;
      }
      default:
        throw new ScriptError(`don't know "${verb}" in "${step}"; use tap, hold, release or wait`);
    }
  }
  if (events.length === 0) throw new ScriptError("the script has no key presses");
  // A key still down at the end is let go in reverse order, as a hand would.
  for (const p of [...clock.down].reverse()) emit(clock.t, p, "release");
  return events;
}

function pressKey(position: number, clock: Clock, step: string, emit: (at: number, p: number, a: "press") => void): void {
  if (clock.down.includes(position)) throw new ScriptError(`key ${position + 1} is already down in "${step}"`);
  clock.down.push(position);
  emit(clock.t, position, "press");
}

function releaseKey(position: number, at: number, clock: Clock, step: string, emit: (at: number, p: number, a: "release") => void): void {
  const i = clock.down.indexOf(position);
  if (i < 0) throw new ScriptError(`key ${position + 1} isn't down in "${step}", so it can't be released`);
  clock.down.splice(i, 1);
  emit(at, position, "release");
}
