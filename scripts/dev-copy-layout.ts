// Runs the real app over BK's Oryx fixture with a scripted model that copies the Moonlander layout onto a
// Corne ("put my Moonlander setup on my Corne"), so the copy proposal and the made-config card can be tried
// or screenshotted without spending API credits:
//
//   bun scripts/dev-copy-layout.ts [port] [dataDir] [ask]       # default 4493, a fresh temp directory
//
// Every message gets the same reply. Nothing here can build or flash; the build routes are not served.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicModel } from "../src/agent/anthropic-model.ts";
import { importLayout, listLayouts, openApp } from "../src/app/index.ts";
import { appChatBackend } from "../src/cli/chat-backend.ts";
import { appEditorBackend } from "../src/cli/editor-backend.ts";
import { type EditorBackend, EditorError } from "../src/server/editor-backend.ts";
import { type ConfigsBackend, ConfigsError } from "../src/server/configs-backend.ts";
import { appConfigsBackend } from "../src/cli/configs-backend.ts";
import { appLayoutSource } from "../src/cli/serve.ts";
import { createSyncEngine } from "../src/app/index.ts";
import { startServer } from "../src/server/start-server.ts";
import { type ScriptStep, fakeAnthropic } from "../test/helpers/fake-anthropic.ts";
import { FIXTURE_DIR } from "../test/helpers/board.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.argv[2] ?? 4493);
const app = openApp({ dataDir: process.argv[3] ?? mkdtempSync(join(tmpdir(), "keyloom-copy-")) });
if (listLayouts(app).length === 0) await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Moonlander daily" });

const turn: ScriptStep[] = [
  { blocks: [{ tool: "list_layouts", input: {} }] },
  { blocks: [{ tool: "put_config", input: { from: "Moonlander daily", board: "foostan/corne" } }] },
  { blocks: [{ text: "I made a new config, \"Moonlander daily on Corne\", on your Corne from your Moonlander daily layout. Your Moonlander config is untouched, and nothing has been built or flashed.\n\nThe Corne has far fewer keys than the Moonlander, so most of the top row, the number row and the thumb clusters had no key of their own. Where I could, I matched keys by what they type and then by place; the keys that did not fit are listed as not carried,.\n\nI stored two proposals on the new config for you to review: one that carries everything that fits, and one that also places the layer keys that had no counterpart, each on a key of the Corne chosen among the candidates. Say if you would rather keep positions than match by what keys type." }] },
];
// `ask` as the third argument replaces the copy with one question and a closing reply to its answer, so the question card can be tried too.
const ask: ScriptStep[] = [{ blocks: [{ tool: "ask_user", input: { question: "Should the thumb keys keep their positions, or match by what they type?", options: [
  { label: "Match by what keys type", description: "Carries the most keys; some land on a different place.", recommended: true },
  { label: "Keep positions", description: "Each key stays where it was; keys with no place are left off." },
], allowOther: true } }] },
// An answer gets a reply of its own, so answering does not just ask the same question again.
{ blocks: [{ text: "Thanks, that settles it. In this demo nothing more happens: the real agent would revise the proposal with your answer." }] }];
const script = Array.from({ length: 8 }, () => (process.argv[4] === "ask" ? ask : turn)).flat();

// The real editor backend serves build and flash routes; a demo must not reach a keyboard, so they refuse.
const noHardware = () => Promise.reject(new EditorError(503, "demo_no_hardware", "This demo doesn't build or flash."));
const editor = { ...appEditorBackend(app), startBuild: noHardware, startFlash: noHardware } satisfies EditorBackend;
// Using a config starts a sync, which would write to a connected keyboard.
const configs = {
  ...appConfigsBackend(app, createSyncEngine(app)),
  use: () => Promise.reject(new ConfigsError(409, "demo_no_hardware", "This demo doesn't put a config on a keyboard.")),
} satisfies ConfigsBackend;
const server = startServer({
  port, source: appLayoutSource(app), editor, chat: appChatBackend(app, { model: anthropicModel(fakeAnthropic(script).client) }), token: "dev-token",
  // The config card reads /api/configs. The engine is never started, and using a config refuses, so nothing reads or writes a keyboard.
  configs,
});
console.log(server.url);
