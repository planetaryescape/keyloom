// A scripted keyboard for the typing lab's screens (D-314): when the lab starts listening, a fake Moonlander "types" a script over
// the real stream protocol: steady keys, S-then-D rolls held long enough to fire Option, a slow left ring finger and a few pinky typos.
// The replay is the model in typing-lab.ts. Nothing here can reach a real keyboard.
import type { BoardDefinition } from "../../src/boards/schema.ts";
import type { LabDeps } from "../../src/app/index.ts";
import { startQmkCapture } from "../../src/firmware/qmk/typing-capture.ts";
import type { TypingEvent } from "../../src/firmware/qmk/typing-stream.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { fakeMoonlander, moonlanderInterface } from "./fake-key-stream.ts";
import { letterPositions, modelReplay } from "./typing-lab.ts";

/** What the scripted hands type; the browser types the same text, so what came out matches what was pressed. */
export const SCRIPT = "sad desks and wisdom she asked us to add wisdom to a sales list kids said a long joke fades as wisdom asks";

// The left ring finger's keys.
const RING = new Set(["s", "w", "x"]);
// The third and the seventh "a" come out as "q": the left pinky reaching one row too high.
const PINKY_TYPOS = new Set([3, 7]);

/** The strokes of the script: 150 ms a key, the left ring finger 90 ms slower, every "sd" a roll with S down 260 ms. */
export function scriptEvents(layout: Layout, start: number, script = SCRIPT): TypingEvent[] {
  const at = letterPositions(layout);
  const space = (layout.layers[0]?.bindings ?? []).findIndex((b) => (b.kind === "key" && b.code === "SPACE") || (b.kind === "holdTap" && b.tap.code === "SPACE"));
  const events: TypingEvent[] = [];
  let t = start;
  const chars = [...script];
  let aCount = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    if (ch === " ") {
      t += 150;
      events.push({ position: space, pressed: true, atMs: t }, { position: space, pressed: false, atMs: t + 80 });
      continue;
    }
    // A typo is a wrong key pressed by the finger next door; the browser's text still says what was meant.
    if (ch === "a") aCount++;
    const typed = ch === "a" && PINKY_TYPOS.has(aCount) ? "q" : ch;
    const position = at[typed];
    if (position === undefined) continue;
    t += RING.has(ch) ? 240 : 150;
    if (ch === "s" && chars[i + 1] === "d") {
      const d = at.d as number;
      events.push({ position, pressed: true, atMs: t }, { position: d, pressed: true, atMs: t + 150 }, { position: d, pressed: false, atMs: t + 190 }, { position, pressed: false, atMs: t + 260 });
      t += 300;
      i++;
      continue;
    }
    events.push({ position, pressed: true, atMs: t }, { position, pressed: false, atMs: t + 85 });
  }
  return events;
}

/** Lab deps whose keyboard types the script a moment after it starts listening, and whose replay is the model. */
export function scriptedLabDeps(board: BoardDefinition, layoutOf: () => Layout, opts: { delayMs?: number; script?: () => string } = {}): LabDeps {
  return {
    async startCapture(_board, hooks) {
      const keyboard = fakeMoonlander();
      const capture = await startQmkCapture(keyboard.transport, moonlanderInterface(), hooks);
      setTimeout(() => keyboard.press(scriptEvents(layoutOf(), 1_000_100, opts.script?.() ?? SCRIPT)), opts.delayMs ?? 50);
      return capture;
    },
    replay: () => modelReplay(board),
  };
}
