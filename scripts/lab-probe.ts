#!/usr/bin/env bun
// Hardware probe for the typing lab's runbooks (docs/research/spikes/S50.md, S51.md): starts the key stream on the keyboard that is
// plugged in, prints every event as it arrives with its source and the gap since the last, keeps the stream alive, and says how it ended.
// It writes nothing to keyloom's database. Never run by the build or by tests: it sends the start command to a real keyboard.
//
//   bun scripts/lab-probe.ts qmk|zmk [--seconds 30] [--board moergo/glove80] [--no-stop]
//
// --no-stop leaves the process without telling the keyboard to stop (it exits the way a crashed host would), to check that the
// keyboard ends the stream by itself within 3 seconds.
import { showBoard } from "../src/app/boards.ts";
import { realLabDeps } from "../src/app/lab.ts";

const args = process.argv.slice(2);
const firmware = args[0];
const flag = (name: string) => args.indexOf(`--${name}`);
const seconds = Number(args[flag("seconds") + 1] ?? 30);
const boardId = flag("board") >= 0 ? (args[flag("board") + 1] as string) : firmware === "zmk" ? "moergo/glove80" : "zsa/moonlander";
if (firmware !== "qmk" && firmware !== "zmk") {
  console.error("usage: bun scripts/lab-probe.ts qmk|zmk [--seconds 30] [--board <id>] [--no-stop]");
  process.exit(2);
}
const board = showBoard(boardId).definition;
let last = 0;
let count = 0;
const capture = await realLabDeps().startCapture(board, {
  onEvent: (e) => {
    count++;
    console.log(`${String(Math.round(e.at)).padStart(8)} ms  +${String(Math.round(e.at - last)).padStart(4)}  key ${String(e.position + 1).padStart(3)}  ${e.action.padEnd(7)}${e.source === undefined ? "" : `  source ${e.source}`}`);
    last = e.at;
  },
});
console.log(`streaming from ${board.name} for ${seconds} s; type now`);
const reason = await Promise.race([capture.ended, new Promise<string>((r) => setTimeout(() => r("the time you asked for"), seconds * 1000))]);
if (args.includes("--no-stop")) {
  console.log(`leaving without a stop (${reason}); ${count} events so far. Wait 5 seconds, then run the probe again: it should connect.`);
  process.exit(0);
}
const trace = await capture.finish();
console.log(`ended by ${trace.endedBy === "host" ? reason : trace.endedBy}; ${trace.events.length} events`);
for (const w of trace.warnings) console.log(`warning: ${w}`);
