// Runs the editor over the synchronized Oryx layout on the live Moonlander board, with an in-memory fake
// backend, so the whole journey (edit, apply, undo, build, flash) can be tried or screenshotted without Docker
// or a keyboard:
//
//   bun scripts/dev-editor.ts [port]          # default 4490
//
// Environment: KEYLOOM_FAKE_FAIL_BUILD=1 or KEYLOOM_FAKE_FAIL_FLASH=1 make that step fail;
// KEYLOOM_FAKE_NO_KEYBOARD=0 makes the fake detect a keyboard (the default asks for Rev A or B);
// KEYLOOM_FAKE_BUILD_MS and KEYLOOM_FAKE_FLASH_STEP_MS change how long they take.
// The chat plays a scripted Option-Option conversation (a question, then three proposals):
// KEYLOOM_FAKE_CHAT=missing_key|busy|drop_midstream makes it fail that way, and
// KEYLOOM_FAKE_TOKEN_MS sets the delay between streamed words (default 35).
// Edits live in memory and vanish when the process stops. Ctrl-C stops it.
import { FakeChat } from "../test/helpers/fake-chat-backend.ts";
import { FakeEditor } from "../test/helpers/fake-editor-backend.ts";
import { devSample } from "../test/helpers/dev-sample.ts";
import { startServer } from "../src/server/start-server.ts";

const port = Number(process.argv[2] ?? 4490);
const fixture = await devSample();
const fake = new FakeEditor(fixture, {
  failBuild: process.env.KEYLOOM_FAKE_FAIL_BUILD === "1",
  failFlash: process.env.KEYLOOM_FAKE_FAIL_FLASH === "1",
  needsBoardRevision: process.env.KEYLOOM_FAKE_NO_KEYBOARD !== "0",
  buildMs: Number(process.env.KEYLOOM_FAKE_BUILD_MS ?? 10_000),
  flashStepMs: Number(process.env.KEYLOOM_FAKE_FLASH_STEP_MS ?? 5_000),
});

const chatMode = process.env.KEYLOOM_FAKE_CHAT;
const chat = new FakeChat(fake, "moonlander-daily", {
  missingKey: chatMode === "missing_key",
  busy: chatMode === "busy",
  failMidStream: chatMode === "drop_midstream",
  tokenDelayMs: Number(process.env.KEYLOOM_FAKE_TOKEN_MS ?? 35),
});

const server = startServer({ port, source: fake.source(), editor: fake, chat, token: "dev-editor-token" });
console.log(server.url);
