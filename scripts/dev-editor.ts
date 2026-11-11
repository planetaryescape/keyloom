// Runs the editor over the synchronized Oryx layout on the live Moonlander board, with an in-memory fake
// backend, so the whole journey (edit, apply, undo, build, flash) can be tried or screenshotted without Docker
// or a keyboard:
//
//   bun scripts/dev-editor.ts [port]          # default 4490
//
// Environment: KEYLOOM_FAKE_FAIL_BUILD=1 or KEYLOOM_FAKE_FAIL_FLASH=1 make that step fail;
// KEYLOOM_FAKE_NO_KEYBOARD=0 makes the fake detect a keyboard (the default asks for Rev A or B);
// KEYLOOM_FAKE_BUILD_MS and KEYLOOM_FAKE_FLASH_STEP_MS change how long they take.
// KEYLOOM_FAKE_FAIL_BUILD=docker fails the build because Docker is missing, with its code (D-488); =compile fails it with a compile
// error that repeats every time, naming the previous revision as the last that built (R5-02).
// KEYLOOM_FAKE_FLASH_RESULT=unverified|files_and_folders ends the flash written but not confirmed, or refused by Files and Folders;
// KEYLOOM_FAKE_INPUT_MONITORING=1 makes the flash wait for the reset key because Input Monitoring was refused; KEYLOOM_FAKE_CHECK_FINDS
// sets what Check the keyboard again finds (this_build by default; absent, other_build, bootloader...) (D-501).
// KEYLOOM_FAKE_DOCKER=no-access-linux|no-access-mac makes Docker refuse this account (D-497); colima-broken makes Colima fail to start,
// and its Restart Colima succeed after a few seconds; colima-dead makes the restart fail too (R3-04); colima-busy holds a start for
// something else for 6 s, so a restart then is refused as engine_busy (R4-04).
// KEYLOOM_FAKE_FLASH=manual gives the board no flash recipe (D-490); KEYLOOM_FAKE_FLASH=no-zapp leaves Zapp off the computer, and
// its Install button installs a fake one in about four seconds (D-489).
// The chat plays a scripted Option-Option conversation (a question, then three proposals):
// KEYLOOM_FAKE_CHAT=missing_key|busy|drop_midstream makes it fail that way (codex_missing: locked to a Codex that isn't installed);
// KEYLOOM_FAKE_CHAT=fail_after_accept:<kind> accepts each message as a saved run and fails it after a moment with that provider failure
// (auth, no_credits, permission, rate_limit, overloaded, server, connection or context_full), stored with the run (R4-02). And
// KEYLOOM_FAKE_TOKEN_MS sets the delay between streamed words (default 35). With missing_key, a pasted key containing "bad"
// is refused and any other is "saved"; KEYLOOM_FAKE_CODEX_SIGNIN_MS holds the pretend Codex sign-in that long (default 1500).
// Edits live in memory and vanish when the process stops. Ctrl-C stops it.
import { FakeChat } from "../test/helpers/fake-chat-backend.ts";
import { FakeEditor } from "../test/helpers/fake-editor-backend.ts";
import { devSample } from "../test/helpers/dev-sample.ts";
import { startServer } from "../src/server/start-server.ts";
import type { InstallState } from "../src/api/tool-install.ts";
import { FlashCheckResponseSchema, type FlashPlan } from "../src/api/http.ts";
import type { SystemBackend } from "../src/server/system-backend.ts";
import { dockerAccessFix } from "../src/app/toolchain.ts";
import { type FailureKind, isFailureKind } from "../test/helpers/model-failures.ts";

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
  failBuildCompile: process.env.KEYLOOM_FAKE_FAIL_BUILD === "compile",
  failBuild: process.env.KEYLOOM_FAKE_FAIL_BUILD === "1",
  failFlash: process.env.KEYLOOM_FAKE_FAIL_FLASH === "1",
  flashResult: process.env.KEYLOOM_FAKE_FLASH_RESULT === "unverified" ? "unverified" : process.env.KEYLOOM_FAKE_FLASH_RESULT === "files_and_folders" ? "permission_files_and_folders" : "verified",
  flashInputMonitoring: process.env.KEYLOOM_FAKE_INPUT_MONITORING === "1",
  checkFinds: FlashCheckResponseSchema.shape.found.parse(process.env.KEYLOOM_FAKE_CHECK_FINDS ?? "this_build"),
  needsBoardRevision: process.env.KEYLOOM_FAKE_NO_KEYBOARD !== "0",
  buildMs: Number(process.env.KEYLOOM_FAKE_BUILD_MS ?? 10_000),
  flashStepMs: Number(process.env.KEYLOOM_FAKE_FLASH_STEP_MS ?? 5_000),
});
// A compile failure goes back to the revision before it (R5-02), so it needs one: an edit made before the page loads.
if (process.env.KEYLOOM_FAKE_FAIL_BUILD === "compile") {
  const layerId = fixture.document.layers[0]?.id ?? "layer-0";
  await fake.apply("moonlander-daily", { baseRevisionId: fixture.revision.id, summary: "Cleared the top-left key", ops: [{ op: "setBinding", at: { layerId, position: 0 }, binding: { kind: "none" } }] });
}

const chatMode = process.env.KEYLOOM_FAKE_CHAT;
function failAfterAcceptance(mode: string | undefined): FailureKind | null {
  if (!mode?.startsWith("fail_after_accept:")) return null;
  const kind = mode.slice("fail_after_accept:".length);
  if (!isFailureKind(kind)) throw new Error(`KEYLOOM_FAKE_CHAT=${mode}: unknown failure "${kind}"`);
  return kind;
}
const chat = new FakeChat(fake, "moonlander-daily", {
  missingKey: chatMode === "missing_key",
  busy: chatMode === "busy",
  failMidStream: chatMode === "drop_midstream",
  // Started as if with --provider codex and no Codex CLI; the Install Codex button "installs" it in about four seconds (R3-24).
  codexLocked: chatMode === "codex_missing" ? { installed: () => installState("codex").status === "succeeded" } : null,
  failAfterAcceptance: failAfterAcceptance(chatMode),
  tokenDelayMs: Number(process.env.KEYLOOM_FAKE_TOKEN_MS ?? 35),
});

// Docker is always up here; an install finishes after a few seconds and, for Zapp, puts it in the build's flash plan.
let installs = new Map<string, { startedAt: number; cancelled: boolean }>();
const installState = (tool: InstallState["tool"]): InstallState => {
  const started = installs.get(tool);
  if (started === undefined) return { tool, status: "idle", phase: null, logTail: [], error: null, errorCode: null };
  if (started.cancelled) return { tool, status: "cancelled", phase: null, logTail: [`keyloom: brew install ${tool}`, "keyloom: stopping the install"], error: null, errorCode: null };
  const done = Date.now() - started.startedAt > 4000;
  if (done && tool === "zapp") Object.assign(flashPlan, zappPlan(true));
  return { tool, status: done ? "succeeded" : "running", phase: done ? null : "installing", logTail: [`keyloom: brew install ${tool}`, `==> Pouring ${tool}--1.0.2.arm64_sequoia.bottle.tar.gz`], error: null, errorCode: null };
};
const dockerMode = process.env.KEYLOOM_FAKE_DOCKER;
const colimaBroken = dockerMode === "colima-broken" || dockerMode === "colima-dead" || dockerMode === "colima-busy";
let colimaRestarted = false;
// colima-busy: a start for something else (a build) holds the engine for 6 s from the first readiness; a restart meanwhile is refused (R4-04).
let busyUntil: number | null = null;
const engineAction = (): "start" | null => {
  if (dockerMode !== "colima-busy") return null;
  busyUntil ??= Date.now() + 6000;
  return Date.now() < busyUntil ? "start" : null;
};
const ALTERNATIVES = [{ name: "Docker Desktop", url: "https://www.docker.com/products/docker-desktop/" }, { name: "OrbStack", url: "https://orbstack.dev/" }];
const system: SystemBackend = {
  docker: async () => dockerMode === "no-access-linux" || dockerMode === "no-access-mac"
    ? {
        ok: false, problem: "no-access", reason: "Docker is running, but your account isn't allowed to use it.", engine: dockerMode === "no-access-mac" ? "Colima" : "the Docker service",
        canStart: false, autoStart: true, install: null, access: dockerAccessFix(dockerMode === "no-access-mac" ? "darwin" : "linux", dockerMode === "no-access-mac" ? { name: "Colima", command: ["colima", "start"] } : { name: "the Docker service", command: ["systemctl", "start", "docker"] }),
      }
    : colimaBroken && !colimaRestarted
      ? { ok: false, problem: "daemon-down", reason: "The Docker daemon isn't running.", engine: "Colima", canStart: true, autoStart: true, install: null, access: null, restartEngine: "Colima", alternatives: ALTERNATIVES, engineAction: engineAction() }
      : { ok: true, version: "29.0.0", engine: "Docker", autoStart: true },
  startDocker: async () => colimaBroken && !colimaRestarted
    ? (await Bun.sleep(1500), { ok: false, reason: "keyloom couldn't start Colima: error starting vm: exit status 1", engine: "Colima" })
    : { ok: true, version: "29.0.0", engine: "Docker", waitedMs: 0 },
  install: async (tool) => {
    if (installs.get(tool) === undefined || installState(tool).status !== "running") installs = new Map([...installs, [tool, { startedAt: Date.now(), cancelled: false }]]);
    return installState(tool);
  },
  installState: async (tool) => installState(tool),
  cancelInstall: async (tool) => {
    const started = installs.get(tool);
    if (started !== undefined && installState(tool).status === "running") started.cancelled = true;
    return installState(tool);
  },
  restartDocker: async () => {
    if (!colimaBroken) return { ok: true, version: "29.0.0", engine: "Docker", waitedMs: 0 };
    if (engineAction() !== null) return { ok: false, code: "engine_busy", reason: "keyloom is already starting Docker, for this page or for a build. Wait for that to finish, then check again.", engine: null };
    await Bun.sleep(3000);
    if (dockerMode === "colima-dead") return { ok: false, reason: "keyloom couldn't start Colima: error starting vm: exit status 1", engine: "Colima" };
    colimaRestarted = true;
    return { ok: true, version: "29.0.0", engine: "Colima", waitedMs: 3000 };
  },
};

const server = startServer({ port, source: fake.source(), editor: fake, chat, system, token: "dev-editor-token" });
console.log(server.url);
