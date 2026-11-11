// Runs the editor over the synchronized Oryx layout on the live Moonlander board, with an in-memory fake
// backend, so the whole journey (edit, apply, undo, build, flash) can be tried or screenshotted without Docker
// or a keyboard:
//
//   bun scripts/dev-editor.ts [port]          # default 4490
//
// Environment: KEYLOOM_FAKE_FAIL_BUILD=1 or KEYLOOM_FAKE_FAIL_FLASH=1 make that step fail;
// KEYLOOM_FAKE_NO_KEYBOARD=0 makes the fake detect a keyboard (the default asks for Rev A or B);
// KEYLOOM_FAKE_BUILD_MS and KEYLOOM_FAKE_FLASH_STEP_MS change how long they take.
// KEYLOOM_FAKE_FAIL_BUILD=docker fails the build because Docker is missing, with its code (D-488).
// KEYLOOM_FAKE_DOCKER=no-access-linux|no-access-mac makes Docker refuse this account (D-497).
// KEYLOOM_FAKE_FLASH=manual gives the board no flash recipe (D-490); KEYLOOM_FAKE_FLASH=no-zapp leaves Zapp off the computer, and
// its Install button installs a fake one in about four seconds (D-489).
// The chat plays a scripted Option-Option conversation (a question, then three proposals):
// KEYLOOM_FAKE_CHAT=missing_key|busy|drop_midstream makes it fail that way, and
// KEYLOOM_FAKE_TOKEN_MS sets the delay between streamed words (default 35). With missing_key, a pasted key containing "bad"
// is refused and any other is "saved"; KEYLOOM_FAKE_CODEX_SIGNIN_MS holds the pretend Codex sign-in that long (default 1500).
// Edits live in memory and vanish when the process stops. Ctrl-C stops it.
import { FakeChat } from "../test/helpers/fake-chat-backend.ts";
import { FakeEditor } from "../test/helpers/fake-editor-backend.ts";
import { devSample } from "../test/helpers/dev-sample.ts";
import { startServer } from "../src/server/start-server.ts";
import type { InstallState } from "../src/api/tool-install.ts";
import type { FlashPlan } from "../src/api/http.ts";
import type { SystemBackend } from "../src/server/system-backend.ts";
import { dockerAccessFix } from "../src/app/toolchain.ts";

const port = Number(process.argv[2] ?? 4490);
const fixture = await devSample();
const flashMode = process.env.KEYLOOM_FAKE_FLASH;
const zappPlan = (installed: boolean): FlashPlan => ({ manual: null, tool: { name: "zapp", installed, canInstall: true, url: "https://github.com/zsa/zapp" }, canReveal: true });
const flashPlan: FlashPlan = flashMode === "manual"
  ? { manual: "Put the board in its bootloader, then flash the file with QMK Toolbox.", tool: null, canReveal: true }
  : zappPlan(flashMode !== "no-zapp");
const fake = new FakeEditor(fixture, {
  flashPlan,
  failBuildDocker: process.env.KEYLOOM_FAKE_FAIL_BUILD === "docker",
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

// Docker is always up here; an install finishes after a few seconds and, for Zapp, puts it in the build's flash plan.
let installs = new Map<string, { startedAt: number }>();
const installState = (tool: InstallState["tool"]): InstallState => {
  const started = installs.get(tool);
  if (started === undefined) return { tool, status: "idle", phase: null, logTail: [], error: null, errorCode: null };
  const done = Date.now() - started.startedAt > 4000;
  if (done && tool === "zapp") Object.assign(flashPlan, zappPlan(true));
  return { tool, status: done ? "succeeded" : "running", phase: done ? null : "installing", logTail: [`keyloom: brew install ${tool}`, `==> Pouring ${tool}--1.0.2.arm64_sequoia.bottle.tar.gz`], error: null, errorCode: null };
};
const dockerMode = process.env.KEYLOOM_FAKE_DOCKER;
const system: SystemBackend = {
  docker: async () => dockerMode === "no-access-linux" || dockerMode === "no-access-mac"
    ? {
        ok: false, problem: "no-access", reason: "Docker is running, but your account isn't allowed to use it.", engine: dockerMode === "no-access-mac" ? "Colima" : "the Docker service",
        canStart: false, autoStart: true, install: null, access: dockerAccessFix(dockerMode === "no-access-mac" ? "darwin" : "linux", dockerMode === "no-access-mac" ? { name: "Colima", command: ["colima", "start"] } : { name: "the Docker service", command: ["systemctl", "start", "docker"] }),
      }
    : { ok: true, version: "29.0.0", engine: "Docker", autoStart: true },
  startDocker: async () => ({ ok: true, version: "29.0.0", engine: "Docker", waitedMs: 0 }),
  install: async (tool) => {
    if (installs.get(tool) === undefined || installState(tool).status !== "running") installs = new Map([...installs, [tool, { startedAt: Date.now() }]]);
    return installState(tool);
  },
  installState: async (tool) => installState(tool),
};

const server = startServer({ port, source: fake.source(), editor: fake, chat, system, token: "dev-editor-token" });
console.log(server.url);
