// Runs the editor over the Moonlander sample with an in-memory fake backend, so the whole journey
// (edit, apply, undo, build, flash) can be tried or screenshotted without Docker or a keyboard:
//
//   bun scripts/dev-editor.ts [port]          # default 4490
//
// Environment: KEYLOOM_FAKE_FAIL_BUILD=1 or KEYLOOM_FAKE_FAIL_FLASH=1 make that step fail;
// KEYLOOM_FAKE_BUILD_MS and KEYLOOM_FAKE_FLASH_STEP_MS change how long they take.
// Edits live in memory and vanish when the process stops. Ctrl-C stops it.
import { FakeEditor } from "../test/helpers/fake-editor-backend.ts";
import { loadFixture } from "../test/server/fixture.ts";
import { startServer } from "../src/server/start-server.ts";

const port = Number(process.argv[2] ?? 4490);
const fixture = await loadFixture();
const fake = new FakeEditor(fixture, {
  failBuild: process.env.KEYLOOM_FAKE_FAIL_BUILD === "1",
  failFlash: process.env.KEYLOOM_FAKE_FAIL_FLASH === "1",
  buildMs: Number(process.env.KEYLOOM_FAKE_BUILD_MS ?? 10_000),
  flashStepMs: Number(process.env.KEYLOOM_FAKE_FLASH_STEP_MS ?? 5_000),
});

const server = startServer({ port, source: fake.source(), editor: fake, token: "dev-editor-token" });
console.log(server.url);
