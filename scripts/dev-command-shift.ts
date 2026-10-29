// Runs the real app (database, validator, server) over BK's Oryx fixture with a scripted model that
// plays the refine loop (D-452), so the cards can be tried or screenshotted without spending API credits:
//
//   bun scripts/dev-command-shift.ts [port] [dataDir]       # default 4491, a fresh temp directory
//
// Conversation 1 ("I want one key for Command–Shift ...") gets one proposal, question 1 of 2, a revised
// proposal after the answer "No, keep them where they are", question 2 of 2, and the final proposal after
// "Yes, F16's key is fine". Conversation 2 ("Make F16 Command–Shift ...") gets one proposal and no question.
// The pair repeats for later conversations. Nothing here can build or flash; the build routes are not served.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicModel } from "../src/agent/anthropic-model.ts";
import { importLayout, listLayouts, openApp } from "../src/app/index.ts";
import { appChatBackend } from "../src/cli/chat-backend.ts";
import { appEditorBackend } from "../src/cli/editor-backend.ts";
import { type EditorBackend, EditorError } from "../src/server/editor-backend.ts";
import { appLayoutSource } from "../src/cli/serve.ts";
import { startServer } from "../src/server/start-server.ts";
import { fakeAnthropic } from "../test/helpers/fake-anthropic.ts";
import { quickScript, refineScript } from "../test/helpers/refine-journey.ts";
import { FIXTURE_DIR } from "../test/helpers/board.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.argv[2] ?? 4491);
const app = openApp({ dataDir: process.argv[3] ?? mkdtempSync(join(tmpdir(), "keyloom-cs-")) });
if (listLayouts(app).length === 0) await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Moonlander daily" });

// The script is the same one the journey tests use (test/helpers/refine-journey.ts).
const script = Array.from({ length: 6 }, () => [...refineScript(), ...quickScript()]).flat();

const client: Anthropic = fakeAnthropic(script).client;
const model = anthropicModel(client);
// The real editor backend serves build and flash routes; a demo must not reach a keyboard, so they refuse.
const noHardware = () => Promise.reject(new EditorError(503, "demo_no_hardware", "This demo doesn't build or flash."));
const editor = { ...appEditorBackend(app), startBuild: noHardware, startFlash: noHardware } satisfies EditorBackend;
const server = startServer({
  port, source: appLayoutSource(app), editor, chat: appChatBackend(app, { model }), token: "dev-token",
});
console.log(server.url);
