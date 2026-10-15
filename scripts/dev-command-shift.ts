// Runs the real app (database, validator, server) over BK's Oryx fixture with a scripted model that
// plays the Command-Shift conversation, so the comparison UI can be tried or screenshotted without
// spending API credits:
//
//   bun scripts/dev-command-shift.ts [port] [dataDir]       # default 4491, a fresh temp directory
//
// Message 1 gets questions. Message 2 gets two recorded priorities and three alternatives; the script
// repeats for later conversations. Nothing here can build or flash; the build routes are not served.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicModel } from "../src/agent/anthropic-model.ts";
import { importLayout, listLayouts, openApp } from "../src/app/index.ts";
import { appChatBackend } from "../src/cli/chat-backend.ts";
import { appEditorBackend } from "../src/cli/editor-backend.ts";
import { appLayoutSource } from "../src/cli/serve.ts";
import { startServer } from "../src/server/start-server.ts";
import { type ScriptStep, fakeAnthropic } from "../test/helpers/fake-anthropic.ts";
import { FIXTURE_DIR } from "../test/helpers/board.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.argv[2] ?? 4491);
const app = openApp({ dataDir: process.argv[3] ?? mkdtempSync(join(tmpdir(), "keyloom-cs-")) });
if (listLayouts(app).length === 0) await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Moonlander daily" });

const at = (position: number) => ({ layerId: "layer-0", position });
const cmdShift = { kind: "modifier", mods: ["LGUI", "LSFT"] };
const alternatives = [
  {
    title: "Command–Shift where Tab is",
    ops: [
      { op: "setBinding", at: at(42), binding: cmdShift },
      { op: "swapBindings", a: at(44), b: at(45) },
      { op: "swapBindings", a: at(45), b: at(46) },
    ],
    explanation: "Command–Shift takes the Tab key under your left pinky. Tab is still on your left thumb, and X, C and V each move one place left to close the gap.",
    tradeoffs: { gains: ["Command–Shift under the pinky, next to Z", "Backspace and the home row stay put"], costs: ["Cut, copy and paste each move one key", "Tab is on the thumb only"] },
  },
  {
    title: "Command–Shift on the F16 key",
    ops: [
      { op: "dropFunction", function: "key:F16", reason: "you said you never use it" },
      { op: "setBinding", at: at(6), binding: cmdShift },
    ],
    explanation: "The F16 key on the top row is free to give up. Command–Shift goes there, which is a stretch from the home row.",
    tradeoffs: { gains: ["Nothing you use moves"], costs: ["The key is a long reach from the home row", "F16 is gone"] },
  },
  {
    title: "Command–Shift on Backspace",
    ops: [
      { op: "swapBindings", a: at(28), b: at(42) },
      { op: "setBinding", at: at(28), binding: cmdShift },
    ],
    explanation: "The best position for the pinky, but it takes Backspace's place and pushes Backspace down a row.",
    tradeoffs: { gains: ["The easiest key to reach"], costs: ["Backspace moves, which you asked me to keep where it is"] },
  },
];

const turn: ScriptStep[] = [
  { blocks: [{ tool: "get_layout", input: { layers: ["layer-0"] } }, { tool: "find_function", input: { function: "mod:LGUI+LSFT" } }] },
  { blocks: [{ text: "Nothing on your layout sends Command–Shift as one key yet, and the base layer has no free key, so something has to give way.\n\nA few things decide where it goes:\n\n- Which hand has to stay free while you press it?\n- Which keys do you barely use?\n- Is there anything that must stay exactly where it is?" }] },
  { blocks: [
    { tool: "record_priority", input: { priorityKind: "pinned", statement: "keep Backspace where it is", subject: { functions: ["key:BACKSPACE"] } } },
    { tool: "record_priority", input: { priorityKind: "rarely_used", statement: "I barely use F16", subject: { functions: ["key:F16"] } } },
  ] },
  { blocks: [{ tool: "propose_changes", input: { alternatives } }] },
  { blocks: [{ text: "Here are three ways to get a Command–Shift key. Hover an option to see it on the keyboard.\n\n- **Where Tab is** moves four things a little and loses nothing.\n- **On the F16 key** moves nothing you use, but it is a stretch.\n- **On Backspace** is the nicest position, and the only one that moves Backspace, so I would not pick it." }] },
];
const script = Array.from({ length: 8 }, () => turn).flat();

const client: Anthropic = fakeAnthropic(script).client;
const model = anthropicModel(client);
const server = startServer({
  port, source: appLayoutSource(app), editor: appEditorBackend(app), chat: appChatBackend(app, { model }), token: "dev-token",
});
console.log(server.url);
