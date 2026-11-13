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
// error that repeats every time, naming the previous revision as the last that built (R5-02); =stale fails every build on a stale Colima
// mount until Restart Colima and build again (a forced restart, about 3 s) clears it (R6-09); with KEYLOOM_FAKE_FORCE=busy that restart is
// refused because a build runs, and with =fail it fails. With =wait it is refused while a pretend lab analysis runs for 12 s, the page
// waits and restarts by itself once it ends (R7-04). KEYLOOM_FAKE_RESTART_ENGINE names the engine (Colima by default); with "Docker
// Desktop" and =fail, Docker reads down after the failed restart (R7-03). KEYLOOM_FAKE_FAIL_BUILD=folder fails every build because the
// engine doesn't share the build folder, naming KEYLOOM_FAKE_RESTART_ENGINE or Docker Desktop (R7-02).
// KEYLOOM_FAKE_FAIL_BUILD=disk fails every build because Docker's disk is full, until Free Docker's build cache (about 2 s) frees it; with
// KEYLOOM_FAKE_PRUNE=empty the cache was already empty, =busy refuses it because a build runs, =fail fails it (R8-04).
// KEYLOOM_FAKE_SYNC=build_failed gives the Moonlander a sync pill: its auto-sync builds the head with the fake build at once, and when that
// build fails the pill and its toast say so, with Build and flash on that build (R8-01). Pair it with a KEYLOOM_FAKE_FAIL_BUILD mode.
// KEYLOOM_FAKE_SYNC=files_and_folders|files_split|input_monitoring|tool_missing gives the Moonlander a pill that syncs for 3 s (KEYLOOM_FAKE_SYNC_MS) from when a page first follows it, then ends
// as a sync whose flash macOS refused (R9-01: behind, a split board's needs-hand, the Moonlander's reset wait) or whose flash tool is missing
// (R9-10, pair it with KEYLOOM_FAKE_FLASH=no-zapp); =kanata_keyboard shows kanata's checklist with a keyboard keyloom doesn't know by name
// (R9-12). =kanata_refused|kanata_setup|kanata_unwritable|kanata_reload_failed end the MacBook's apply as a config kanata refused, one kanata refused because
// it is older than keyloom writes for, one keyloom couldn't write, or a reload keyloom couldn't finish (R10-01), one change past kanata's layout, or
// KEYLOOM_FAKE_SYNC_CHANGES (a number, or "null" for none counted) past it, which offers History, not Undo; =kanata_first_run is the checklist before Set up and start
// kanata (R10-03); =kanata_no_builtin is a Mac with no built-in keyboard (R10-14); =kanata_foreign offers Replace it, which
// KEYLOOM_FAKE_REPLACE=internal fails with a server exception (R10-05). Open … settings answers ok, or fails with KEYLOOM_FAKE_OPEN_SETTINGS=fail. KEYLOOM_FAKE_PRUNE=daemon answers a prune as
// Docker's daemon being down, =internal fails the request itself (R9-07); KEYLOOM_FAKE_ENGINE names the engine a ready Docker reports
// (KEYLOOM_FAKE_RESTART_ENGINE, or Colima, by default; R10-06).
// KEYLOOM_FAKE_READ_FAIL_AFTER_APPLY=1 fails the first layout read after each apply, as when the change is written but the page
// can't show it (R7-06).
// KEYLOOM_FAKE_FLASH_RESULT=unverified|files_and_folders ends the flash written but not confirmed, or refused by Files and Folders;
// KEYLOOM_FAKE_INPUT_MONITORING=1 makes the flash wait for the reset key because Input Monitoring was refused; KEYLOOM_FAKE_CHECK_FINDS
// sets what Check the keyboard again finds (this_build by default; absent, other_build, bootloader...) (D-501).
// KEYLOOM_FAKE_DOCKER=no-access-linux|no-access-mac makes Docker refuse this account (D-497); colima-broken makes Colima fail to start,
// and its Restart Colima succeed after a few seconds; colima-dead makes the restart fail too (R3-04); colima-busy holds a start for
// something else for 6 s, so a restart then is refused as engine_busy (R4-04). With no-access-mac, Fix Colima's files succeeds after
// about 3 s; KEYLOOM_FAKE_COLIMA_FIX=cancel makes its password dialog cancelled the first time, =fail makes it fail, =linked stops it at a
// linked file, =linked-cancel stops it at a linked file and then has every later dialog cancelled, =busy refuses it as build_running,
// =vm refuses it before the dialog because another account's Colima VM runs (D-533). KEYLOOM_FAKE_COLIMA_SCAN=incomplete holds Colima's
// command back, as a look through ~/.colima that didn't finish does; with =vm the fix then shows Colima's stop on its own (R8-05).
// KEYLOOM_FAKE_FLASH=manual gives the board no flash recipe (D-490); KEYLOOM_FAKE_FLASH=no-zapp leaves Zapp off the computer, and
// its Install button installs a fake one in about four seconds (D-489). KEYLOOM_FAKE_NO_BREW=1 takes Homebrew away, so that button is Get
// Zapp, a pretend download of Zapp's pinned release (D-561); KEYLOOM_FAKE_SYNC=kanata_no_brew is the MacBook's checklist on a Mac without
// Homebrew or kanata, whose Get kanata does the same (D-560). KEYLOOM_FAKE_DOWNLOAD=mismatch ends either download as a checksum mismatch.
// The chat plays a scripted Option-Option conversation (a question, then three proposals):
// KEYLOOM_FAKE_CHAT=missing_key|busy|drop_midstream makes it fail that way (codex_missing: locked to a Codex that isn't installed);
// KEYLOOM_FAKE_CHAT=unreadable refuses each message with an answer the page can't read; KEYLOOM_FAKE_CHAT_STOP=internal, with
// fail_after_accept, keeps each run going and makes Stop hit a server exception (PR #305 review).
// KEYLOOM_FAKE_CHAT=fail_after_accept:<kind> accepts each message as a saved run and fails it after a moment with that provider failure
// (auth, no_credits, permission, rate_limit, overloaded, server, connection or context_full, or Codex's usage_limit), stored with
// the run (R4-02). And
// KEYLOOM_FAKE_TOKEN_MS sets the delay between streamed words (default 35).
// KEYLOOM_FAKE_UNEXPECTED, a comma list, makes requests fail the way no screen planned for (R9-02, R9-05, R9-09): check=internal or
// check=gone fails every change check with a server exception or as a layout deleted elsewhere; upgrade=refused offers Update layout and
// has keyloom's check turn it down; undo=internal fails Undo and Go back. With missing_key, a pasted key containing "bad"
// is refused and any other is "saved"; KEYLOOM_FAKE_CODEX_SIGNIN_MS holds the pretend Codex sign-in that long (default 1500).
// Edits live in memory and vanish when the process stops. Ctrl-C stops it.
import { FakeChat } from "../test/helpers/fake-chat-backend.ts";
import { FakeEditor } from "../test/helpers/fake-editor-backend.ts";
import { devSample } from "../test/helpers/dev-sample.ts";
import { startServer } from "../src/server/start-server.ts";
import type { InstallState } from "../src/api/tool-install.ts";
import { FlashCheckResponseSchema, type FlashPlan } from "../src/api/http.ts";
import type { SystemBackend } from "../src/server/system-backend.ts";
import type { RemapperSetupBackend } from "../src/server/system-remapper-routes.ts";
import type { RemapperSetupResponse } from "../src/api/system-remapper.ts";
import { type SyncBackend, SyncError } from "../src/server/sync-backend.ts";
import { EditorError } from "../src/server/editor-backend.ts";
import type { BoardSync } from "../src/api/http.ts";
import { COLIMA_VM_RUNNING } from "../src/app/colima-files.ts";
import { dockerAccessFix } from "../src/app/toolchain.ts";
import { type ShownFailureKind, isShownFailureKind } from "../test/helpers/model-failures.ts";

const port = Number(process.argv[2] ?? 4490);
const fixture = await devSample();
const flashMode = process.env.KEYLOOM_FAKE_FLASH;
const noBrew = process.env.KEYLOOM_FAKE_NO_BREW === "1" || process.env.KEYLOOM_FAKE_SYNC === "kanata_no_brew";
const zappPlan = (installed: boolean): FlashPlan => ({ manual: null, tool: { name: "zapp", installed, canInstall: !noBrew, canDownload: noBrew, url: "https://github.com/zsa/zapp" }, canReveal: true });
/** A pretend download of a pinned release (D-560, D-561): progress for about four seconds, then kept, or refused with KEYLOOM_FAKE_DOWNLOAD=mismatch. */
const fakeDownload = (name: string, version: string, url: string, startedAt: number) => {
  const elapsed = Date.now() - startedAt;
  const log = [`keyloom: downloading ${name} ${version} from ${url}`, ...[1, 2, 3, 4].filter((q) => elapsed > q * 900).map((q) => `keyloom: ${(q * 0.6).toFixed(1)} of 2.4 MB`)];
  if (elapsed <= 4000) return { state: "running" as const, log, failure: null };
  if (process.env.KEYLOOM_FAKE_DOWNLOAD === "mismatch") {
    return {
      state: "failed" as const, log: [...log, "keyloom: the download's SHA-256 doesn't match the pinned one; nothing was kept"],
      failure: { code: "checksum_mismatch", reason: `The file keyloom downloaded isn't ${name} ${version} as released: its checksum doesn't match. keyloom kept none of it. Try again, and if it happens again, get ${name} from its release page.` },
    };
  }
  return { state: "succeeded" as const, log: [...log, "keyloom: the SHA-256 matches the release", `keyloom: kept ${name} ${version} in ~/Library/Application Support/keyloom/bin`], failure: null };
};
const flashPlan: FlashPlan = flashMode === "manual"
  ? { manual: "Put the board in its bootloader, then flash the file with QMK Toolbox.", tool: null, canReveal: true }
  : zappPlan(flashMode !== "no-zapp");
const restartEngineName = process.env.KEYLOOM_FAKE_RESTART_ENGINE ?? "Colima";
const readyEngine = process.env.KEYLOOM_FAKE_ENGINE ?? restartEngineName;
const fake = new FakeEditor(fixture, {
  flashPlan,
  failBuildDocker: process.env.KEYLOOM_FAKE_FAIL_BUILD === "docker",
  failBuildCompile: process.env.KEYLOOM_FAKE_FAIL_BUILD === "compile",
  failBuildStale: process.env.KEYLOOM_FAKE_FAIL_BUILD === "stale",
  failBuildDisk: process.env.KEYLOOM_FAKE_FAIL_BUILD === "disk",
  restartEngine: restartEngineName,
  failBuildFolder: process.env.KEYLOOM_FAKE_FAIL_BUILD === "folder" ? { engine: process.env.KEYLOOM_FAKE_RESTART_ENGINE ?? "Docker Desktop" } : null,
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
function failAfterAcceptance(mode: string | undefined): ShownFailureKind | null {
  if (!mode?.startsWith("fail_after_accept:")) return null;
  const kind = mode.slice("fail_after_accept:".length);
  if (!isShownFailureKind(kind)) throw new Error(`KEYLOOM_FAKE_CHAT=${mode}: unknown failure "${kind}"`);
  return kind;
}
const chat = new FakeChat(fake, "moonlander-daily", {
  missingKey: chatMode === "missing_key",
  busy: chatMode === "busy",
  failMidStream: chatMode === "drop_midstream",
  // Started as if with --provider codex and no Codex CLI; the Install Codex button "installs" it in about four seconds (R3-24).
  codexLocked: chatMode === "codex_missing" ? { installed: () => installState("codex").status === "succeeded" } : null,
  failAfterAcceptance: failAfterAcceptance(chatMode),
  refuseUnreadable: chatMode === "unreadable",
  stopThrows: process.env.KEYLOOM_FAKE_CHAT_STOP === "internal",
  tokenDelayMs: Number(process.env.KEYLOOM_FAKE_TOKEN_MS ?? 35),
});

// Docker is always up here; an install finishes after a few seconds and, for Zapp, puts it in the build's flash plan.
let installs = new Map<string, { startedAt: number; cancelled: boolean }>();
const installState = (tool: InstallState["tool"]): InstallState => {
  const started = installs.get(tool);
  if (started === undefined) return { tool, status: "idle", phase: null, logTail: [], error: null, errorCode: null };
  if (started.cancelled) return { tool, status: "cancelled", phase: null, logTail: [`keyloom: brew install ${tool}`, "keyloom: stopping the install"], error: null, errorCode: null };
  if (noBrew && tool === "zapp") {
    const got = fakeDownload("Zapp", "1.0.2", "https://github.com/zsa/zapp/releases/download/v1.0.2/zapp-macos-aarch64.tar.gz", started.startedAt);
    if (got.state === "succeeded") Object.assign(flashPlan, zappPlan(true));
    if (got.state === "running") return { tool, status: "running", phase: "downloading", logTail: got.log, error: null, errorCode: null };
    return got.state === "failed"
      ? { tool, status: "failed", phase: null, logTail: got.log, error: got.failure.reason, errorCode: "checksum_mismatch" }
      : { tool, status: "succeeded", phase: null, logTail: got.log, error: null, errorCode: null };
  }
  const done = Date.now() - started.startedAt > 4000;
  if (done && tool === "zapp") Object.assign(flashPlan, zappPlan(true));
  return { tool, status: done ? "succeeded" : "running", phase: done ? null : "installing", logTail: [`keyloom: brew install ${tool}`, `==> Pouring ${tool}--1.0.2.arm64_sequoia.bottle.tar.gz`], error: null, errorCode: null };
};
const dockerMode = process.env.KEYLOOM_FAKE_DOCKER;
const colimaBroken = dockerMode === "colima-broken" || dockerMode === "colima-dead" || dockerMode === "colima-busy";
let colimaRestarted = false;
let colimaFilesFixed = false;
let colimaFixTries = 0;
// colima-busy: a start for something else (a build) holds the engine for 6 s from the first readiness; a restart meanwhile is refused (R4-04).
let busyUntil: number | null = null;
const engineAction = (): "start" | null => {
  if (dockerMode !== "colima-busy") return null;
  busyUntil ??= Date.now() + 6000;
  return Date.now() < busyUntil ? "start" : null;
};
const ALTERNATIVES = [{ name: "Docker Desktop", url: "https://www.docker.com/products/docker-desktop/" }, { name: "OrbStack", url: "https://orbstack.dev/" }];
// A forced restart's pretend progress and the work it waits for (R7-04), and a Mac app it left down (R7-03).
let forcedLines: string[] = [];
let forcing = false;
let labUntil: number | null = null;
let appLeftDown = false;
// KEYLOOM_FAKE_COLIMA_SCAN=incomplete: keyloom's look through ~/.colima didn't finish, so Colima's command is held back (D-533, R8-05).
const heldAccess = (access: ReturnType<typeof dockerAccessFix>) =>
  process.env.KEYLOOM_FAKE_COLIMA_SCAN === "incomplete" && access.fixFiles ? { ...access, command: null, scanIncomplete: true } : access;
const system: SystemBackend = {
  docker: async () => appLeftDown
    ? { ok: false, problem: "daemon-down", reason: `${restartEngineName} isn't running.`, engine: restartEngineName, canStart: true, autoStart: true, install: null, access: null, restartEngine: null, alternatives: [], engineAction: null }
    : (dockerMode === "no-access-linux" || dockerMode === "no-access-mac") && !colimaFilesFixed
    ? {
        ok: false, problem: "no-access", reason: "Docker is running, but your account isn't allowed to use it.", engine: dockerMode === "no-access-mac" ? "Colima" : "the Docker service",
        canStart: false, autoStart: true, install: null, access: heldAccess(dockerAccessFix(dockerMode === "no-access-mac" ? "darwin" : "linux", dockerMode === "no-access-mac" ? { name: "Colima", command: ["colima", "start"] } : { name: "the Docker service", command: ["systemctl", "start", "docker"] })),
      }
    : colimaBroken && !colimaRestarted
      ? { ok: false, problem: "daemon-down", reason: "The Docker daemon isn't running.", engine: "Colima", canStart: true, autoStart: true, install: null, access: null, restartEngine: "Colima", alternatives: ALTERNATIVES, engineAction: engineAction() }
      // As the real readiness does since R10-06: a Docker that answers names the engine behind it.
      : { ok: true, version: "29.0.0", engine: readyEngine, autoStart: true },
  startDocker: async () => {
    // Start it now brings back an app a failed forced restart left down (R7-03).
    appLeftDown = false;
    return colimaBroken && !colimaRestarted
      ? (await Bun.sleep(1500), { ok: false, reason: "keyloom couldn't start Colima: error starting vm: exit status 1", engine: "Colima" })
      : { ok: true, version: "29.0.0", engine: readyEngine, waitedMs: 0 };
  },
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
  restartLog: async () => ({ running: forcing, lines: forcedLines, waitingFor: !forcing && labUntil !== null && Date.now() < labUntil ? ["a lab analysis"] : [] }),
  restartDocker: async (opts) => {
    if (opts?.force === true) {
      const force = process.env.KEYLOOM_FAKE_FORCE;
      if (force === "busy") return { ok: false, code: "build_running", reason: "A build or flash is running, and restarting Docker now would stop it. Restart it once that has finished.", engine: null };
      if (force === "wait") {
        labUntil ??= Date.now() + 12_000;
        if (Date.now() < labUntil) return { ok: false, code: "build_running", reason: "keyloom is running a lab analysis, and restarting Docker now would stop it. Restart Docker once that has finished.", engine: null };
      }
      forcing = true;
      forcedLines = [];
      const steps = restartEngineName === "Colima"
        ? ["keyloom: stopping Colima so it starts from scratch", "keyloom: starting Colima", "INFO[0001] starting colima", "INFO[0002] provisioning ...", "keyloom: waiting for Docker to answer"]
        : [`keyloom: quitting ${restartEngineName}`, `keyloom: opening ${restartEngineName}`, "keyloom: waiting for Docker to answer"];
      for (const line of steps) {
        forcedLines = [...forcedLines, line];
        await Bun.sleep(3000 / steps.length);
      }
      forcing = false;
      if (force === "fail") {
        appLeftDown = restartEngineName !== "Colima";
        return { ok: false, reason: `keyloom couldn't start ${restartEngineName}: it didn't answer within 2 minutes.`, engine: restartEngineName };
      }
      fake.staleMount = false;
      return { ok: true, version: "29.0.0", engine: restartEngineName, waitedMs: 3000 };
    }
    if (!colimaBroken) return { ok: true, version: "29.0.0", engine: "Docker", waitedMs: 0 };
    if (engineAction() !== null) return { ok: false, code: "engine_busy", reason: "keyloom is already starting Docker, for this page or for a build. Wait for that to finish, then check again.", engine: null };
    await Bun.sleep(3000);
    if (dockerMode === "colima-dead") return { ok: false, reason: "keyloom couldn't start Colima: error starting vm: exit status 1", engine: "Colima" };
    colimaRestarted = true;
    return { ok: true, version: "29.0.0", engine: "Colima", waitedMs: 3000 };
  },
  pruneBuildCache: async () => {
    const mode = process.env.KEYLOOM_FAKE_PRUNE;
    if (mode === "busy") return { ok: false, code: "build_running", reason: "keyloom is running a build, and restarting Docker now would stop it. Restart Docker once that has finished." };
    await Bun.sleep(2000);
    if (mode === "daemon") return { ok: false, code: "docker_unavailable", reason: "Docker couldn't free its build cache: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" };
    if (mode === "internal") throw new Error("database is locked");
    if (mode === "fail") return { ok: false, reason: "Docker couldn't free its build cache: Error response from daemon: a prune operation is already running." };
    if (mode === "empty") return { ok: true, freed: "0B" };
    fake.diskFull = false;
    return { ok: true, freed: "1.8GB" };
  },
  fixColimaFiles: async () => {
    const mode = process.env.KEYLOOM_FAKE_COLIMA_FIX;
    if (mode === "busy") return { ok: false, code: "build_running", reason: "A build or flash is running, and restarting Docker now would stop it. Restart it once that has finished.", engine: null };
    if (mode === "vm") return { ok: false, code: "vm_running", reason: COLIMA_VM_RUNNING, engine: "Colima" };
    colimaFixTries += 1;
    if (mode === "linked-cancel" && colimaFixTries > 1) return { ok: false, code: "cancelled", reason: "You cancelled the password dialog, so Colima's files didn't change.", engine: "Colima" };
    await Bun.sleep(mode === "cancel" && colimaFixTries === 1 ? 1500 : 3000);
    if (mode === "cancel" && colimaFixTries === 1) return { ok: false, code: "cancelled", reason: "You cancelled the password dialog, so Colima's files didn't change.", engine: "Colima" };
    if (mode === "fail") return { ok: false, reason: "macOS didn't let keyloom give all of Colima's files back to you.", engine: "Colima" };
    if (mode === "linked" || mode === "linked-cancel") return { ok: false, code: "linked_file", reason: "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: /Users/you/.colima/default/disk", engine: "Colima" };
    colimaFilesFixed = true;
    return { ok: true, version: "29.0.0", engine: "Colima", waitedMs: 3000 };
  },
};


// The first layout read after each apply fails, as when keyloom wrote the change but couldn't read it back (R7-06).
const readFailsAfterApply = Number(process.env.KEYLOOM_FAKE_READ_FAIL_AFTER_APPLY ?? 0);
let readFailures = 0;
const fakeApply = fake.apply.bind(fake);
fake.apply = async (...args) => {
  const applied = await fakeApply(...args);
  readFailures = readFailsAfterApply;
  return applied;
};
const unexpected = new Map((process.env.KEYLOOM_FAKE_UNEXPECTED ?? "").split(",").filter(Boolean).map((pair) => pair.split("=") as [string, string]));
const fakeSource = fake.source();
const source = { ...fakeSource, get: async (ref: string) => {
  if (readFailures > 0) {
    readFailures -= 1;
    throw new Error("database is locked");
  }
  const found = await fakeSource.get(ref);
  return found !== null && unexpected.get("upgrade") === "refused" ? { ...found, upgrade: { colours: true, tapDances: false } } : found;
} };
// A plain Error is the server's exception (500 internal); an EditorError is a route's own answer.
if (unexpected.get("check") === "internal") fake.check = async () => { throw new Error("database is locked"); };
if (unexpected.get("check") === "gone") fake.check = async (ref: string) => { throw new EditorError(404, "not_found", `no layout ${ref}`); };
if (unexpected.get("upgrade") === "refused") fake.upgrade = async () => { throw new EditorError(409, "validation_failed", "the upgrade was not saved: the upgraded layout doesn't parse"); };
if (unexpected.get("undo") === "internal") fake.undo = async () => { throw new Error("database is locked"); };

const syncMode = process.env.KEYLOOM_FAKE_SYNC;
const STATIC_SYNC = ["files_and_folders", "files_split", "input_monitoring", "tool_missing", "kanata_keyboard", "kanata_refused", "kanata_setup", "kanata_unwritable", "kanata_reload_failed", "kanata_first_run", "kanata_no_builtin", "kanata_foreign", "kanata_no_brew"] as const;
// Get kanata in kanata_no_brew (D-560): when it started, or null before it has.
let kanataDownload: { startedAt: number; cancelled: boolean } | null = null;
const kanataJob = (): RemapperSetupResponse["install"] => {
  if (kanataDownload === null) return { state: "idle", action: null, log: [], failure: null };
  if (kanataDownload.cancelled) return { state: "cancelled", action: "download", log: [], failure: { code: "cancelled", reason: "You cancelled the download. keyloom kept nothing." } };
  const got = fakeDownload("kanata", "1.12.0", "https://github.com/jtroo/kanata/releases/download/v1.12.0/macos-binaries-arm64.zip", kanataDownload.startedAt);
  return { state: got.state, action: "download", log: got.log, failure: got.failure };
};
// The checklist's findings for each kanata mode (D-493): a keyboard keyloom doesn't know by name (R9-12), a kanata older than keyloom writes
// for (R10-01), a first run before Set up and start kanata (R10-03), and a Mac with no built-in keyboard (R10-14).
const kanataFindings = (): RemapperSetupResponse["findings"] => {
  const ok = (code: RemapperSetupResponse["findings"][number]["code"], detail = "ok") => ({ code, name: code, status: "ok" as const, detail });
  switch (syncMode) {
    case "kanata_keyboard": return [ok("kanata_version", "1.12.0"), ok("driver_mismatch", "6.2.0"), { code: "keyboard_name", name: "built-in keyboard", status: "warn", detail: "no keyboard named \"Apple Internal Keyboard / Trackpad\" was found; run `kanata --list` and compare" }, ok("port_closed", "kanata answers")];
    case "kanata_setup": return [{ code: "kanata_version", name: "kanata", status: "warn", detail: "1.10.0 at /opt/homebrew/bin/kanata; keyloom writes configs for 1.12.0" }, ok("driver_mismatch", "6.2.0"), ok("keyboard_name"), ok("port_closed", "kanata answers")];
    case "kanata_first_run": return [ok("kanata_version", "1.12.0"), ok("driver_mismatch", "6.2.0"), { code: "permissions", name: "permissions", status: "unknown", detail: "macOS doesn't let keyloom read these grants" }, { code: "daemon_missing", name: "LaunchDaemon", status: "fail", detail: "not installed" }, { code: "port_closed", name: "kanata's port", status: "fail", detail: "nothing answers" }];
    case "kanata_no_brew": return [
      kanataJob().state === "succeeded" ? ok("kanata_version", "1.12.0") : { code: "kanata_missing", name: "kanata", status: "fail", detail: "not found" },
      { code: "driver_missing", name: "driver", status: "fail", detail: "not installed" }, { code: "permissions", name: "permissions", status: "unknown", detail: "macOS doesn't let keyloom read these grants" },
      { code: "daemon_missing", name: "LaunchDaemon", status: "fail", detail: "not installed" }, { code: "port_closed", name: "kanata's port", status: "fail", detail: "nothing answers" },
    ];
    case "kanata_no_builtin": return [ok("kanata_version", "1.12.0"), ok("driver_mismatch", "6.2.0"), { code: "keyboard_name", name: "built-in keyboard", status: "fail", detail: "this Mac has no built-in keyboard" }, ok("port_closed", "kanata answers")];
    default: return [ok("kanata_version", "1.12.0"), ok("driver_mismatch", "6.2.0"), ok("keyboard_name"), ok("port_closed", "kanata answers")];
  }
};
const staticMode = STATIC_SYNC.find((m) => m === syncMode);
const sync = syncMode === "build_failed" ? await fakeBuildFailedSync() : staticMode !== undefined ? await fakeFlashRefusedSync(staticMode) : undefined;
// System Settings never opens here: the fake says it did, or that it didn't with KEYLOOM_FAKE_OPEN_SETTINGS=fail.
const remapperSetup: RemapperSetupBackend | undefined = staticMode === undefined ? undefined : {
  status: async () => ({
    platform: "darwin", canInstall: !noBrew, canDownload: true, install: kanataJob(),
    kanata: syncMode === "kanata_setup"
      ? { version: "1.10.0", wanted: "1.12.0", update: "brew", path: "/opt/homebrew/bin/kanata", copyVersion: "1.10.0" }
      : { version: "1.12.0", wanted: "1.12.0", update: null, path: "/opt/homebrew/bin/kanata", copyVersion: "1.12.0" },
    driverVersion: "6.2.0",
    findings: kanataFindings(),
  }),
  installKanata: async (action) => {
    if (action !== "download") return { ok: false, code: "unsupported", reason: "The dev editor doesn't install kanata." };
    if (kanataJob().state !== "running") kanataDownload = { startedAt: Date.now(), cancelled: false };
    return { ok: true };
  },
  cancelInstall: async () => {
    if (kanataDownload !== null && kanataJob().state === "running") kanataDownload.cancelled = true;
    return { ok: true };
  },
  startKanata: async () => ({ ok: false, code: "unsupported", reason: "The dev editor doesn't start kanata." }),
  openSettings: async (pane) => {
    console.log(`fake: open settings pane ${pane}`);
    return process.env.KEYLOOM_FAKE_OPEN_SETTINGS === "fail" ? { ok: false, code: "failed", reason: "macOS didn't open System Settings: open exited 1" } : { ok: true };
  },
};

// KEYLOOM_FAKE_RESTART=1 answers /api/restart as the desktop app's server would, and /api/log with a log file, so Restart keyloom and Show
// keyloom's log render as they do there. Neither restarts or opens anything.
const desktop = process.env.KEYLOOM_FAKE_RESTART === "1" ? {
  restart: { canRestart: true, command: "keyloom serve", restart: () => console.log("fake: restart asked for") },
  log: { log: { kind: "file" as const, path: "/Users/you/Library/Logs/keyloom/keyloom.log", canShow: true }, show: async () => { console.log("fake: show log"); } },
} : {};
const server = startServer({ port, source, editor: fake, chat, system, ...desktop, ...(sync === undefined ? {} : { sync }), ...(remapperSetup === undefined ? {} : { remapperSetup }), token: "dev-editor-token" });

/**
 * One Moonlander whose sync runs for 3 s, then ends the way `mode` says (R9-01, R9-10, R9-12), so its toast shows too. Each sentence is
 * the flasher's own, which the page must not show as the way on.
 */
async function fakeFlashRefusedSync(mode: (typeof STATIC_SYNC)[number]): Promise<SyncBackend> {
  const sample = await fake.source().get("moonlander-daily");
  if (sample === null) throw new Error("the dev editor has no Daily driver layout");
  const head = sample.revision.id;
  const build = await fake.startBuild("moonlander-daily", { revisionId: head, boardRevision: "revb" });
  // The sync starts when the first page follows it, so a page opened late still sees it end and shows the toast.
  let startedAt = Date.now();
  let followed = false;
  const timings = { waitMs: 0, buildMs: null, flashMs: null, totalMs: null };
  const auto = { on: true, choice: null, paused: false, proven: true, provenAt: startedAt - 86_400_000, dueAt: null };
  const files = "Copying to /Volumes/GLV80RHBOOT/CURRENT.UF2 failed: EACCES: permission denied, open '/Volumes/GLV80RHBOOT/CURRENT.UF2'. The right half was not flashed. keyloom wasn't allowed to write to the drive. On macOS, give the app running keyloom access to removable volumes in System Settings > Privacy & Security > Files & Folders, then flash again.";
  const hand = "macOS didn't let keyloom restart the keyboard by itself. Press the reset button on the Moonlander (the small hole on the left half) within 2 minutes.";
  const zapp = "zapp isn't installed. Install it with `brew install zapp`, then flash again.";
  // kanata's and keyloom's own sentences for a config that didn't go on (R10-01).
  const kanataSentence = {
    kanata_refused: "kanata --check refused the new config, so nothing was changed: Error in configuration: unknown key `lrld-num`",
    kanata_setup: "kanata --check refused the new config, so nothing was changed: Error in configuration: unknown action `tap-hold-release-keys`",
    kanata_unwritable: "this layout can't be written for kanata: key 12 on layer Base: tap dance \"td1\" doesn't exist",
    kanata_reload_failed: "keyloom's reload request failed before kanata answered",
  };
  const status = async (): Promise<BoardSync[]> => {
    const running = Date.now() - startedAt < Number(process.env.KEYLOOM_FAKE_SYNC_MS ?? 3000);
    const base = { boardId: "zsa/moonlander", boardName: "Moonlander", layoutId: "moonlander-daily", layoutName: "Daily driver", headRevisionId: head, otherLayouts: 0, auto };
    const last = (failure: string, error: string, errorCode: string | null) => ({
      id: "sync_1", trigger: "auto" as const, status: running ? "flashing" as const : "failed" as const, step: running ? "writing" : "done", revisionId: head,
      failure: running ? null : failure, error: running ? null : error, errorCode: running ? null : errorCode, buildId: build.id, startedAt, finishedAt: running ? null : Date.now(), timings,
    });
    // The MacBook's modes stand on this page's board, named as the MacBook so the words read as they do there.
    const mac = { ...base, boardName: "MacBook", remapper: true };
    if (mode === "kanata_keyboard" || mode === "kanata_no_builtin") return [{ ...mac, state: { kind: "in_sync" }, last: null }];
    if (mode === "kanata_first_run" || mode === "kanata_no_brew") return [{ ...mac, state: { kind: "not_connected" }, last: null }];
    if (mode === "kanata_foreign") return [{ ...mac, state: { kind: "not_keyloom", detail: "kanata runs /Users/you/kanata.kbd" }, last: null }];
    if (mode === "kanata_refused" || mode === "kanata_setup" || mode === "kanata_unwritable" || mode === "kanata_reload_failed") {
      const code = mode;
      if (running) return [{ ...mac, state: { kind: "syncing", step: "writing", syncId: "sync_1", startedAt, trigger: "auto" }, last: { ...last("build", "", null), buildId: null } }];
      const counted = process.env.KEYLOOM_FAKE_SYNC_CHANGES;
      const changes = counted === undefined ? 1 : counted === "null" ? null : Number(counted);
      return [{ ...mac, state: { kind: "behind", changes, why: "failed", error: kanataSentence[code] }, last: { ...last("build", kanataSentence[code], code), buildId: null } }];
    }
    if (running) return [{ ...base, state: { kind: "syncing", step: "writing", syncId: "sync_1", startedAt, trigger: "auto" }, last: last("flash", "", null) }];
    switch (mode) {
      case "files_and_folders": return [{ ...base, state: { kind: "behind", changes: 1, why: "failed", error: files }, last: last("flash", files, "permission_files_and_folders") }];
      case "files_split": return [{ ...base, state: { kind: "needs_hand", instruction: files, reason: "" }, last: last("flash", files, "permission_files_and_folders") }];
      case "input_monitoring": return [{ ...base, state: { kind: "needs_hand", instruction: hand, reason: "keyloom couldn't restart it by itself", instructionCode: "permission_input_monitoring" }, last: last("needs_hand", "No Moonlander in bootloader mode was found within 2 minutes. Nothing was flashed.", null) }];
      case "tool_missing": return [{ ...base, state: { kind: "behind", changes: 1, why: "failed", error: zapp }, last: last("flash", zapp, "flash_tool_missing") }];
    }
  };
  const refused = (): never => {
    throw new SyncError(400, "busy", "The dev editor's fake sync only shows how a sync ended.");
  };
  return {
    status, syncNow: refused, setAutoSync: refused, setPaused: refused, disableRemapping: refused, confirmExitChord: refused,
    // KEYLOOM_FAKE_REPLACE=internal makes Replace it hit a server exception, so its confirm shows Restart keyloom and the log (R10-05).
    replaceForeignRemapperConfig: process.env.KEYLOOM_FAKE_REPLACE === "internal" ? async () => { throw new Error("database is locked"); } : refused,
    newKeyboards: () => [], setupBoards: () => [],
    subscribe: (listener) => {
      if (!followed) {
        followed = true;
        startedAt = Date.now();
      }
      let last = "";
      const tell = () => void status().then((boards) => {
        const now = JSON.stringify(boards.map((b) => b.state));
        if (now !== last) listener(boards, [], []);
        last = now;
      });
      tell();
      const timer = setInterval(tell, 1000);
      return () => clearInterval(timer);
    },
  };
}

/** One Moonlander whose auto-sync builds the head now, with the fake build, and is behind once that build fails (R8-01). */
async function fakeBuildFailedSync(): Promise<SyncBackend> {
  const sample = await fake.source().get("moonlander-daily");
  if (sample === null) throw new Error("the dev editor has no Daily driver layout");
  const head = sample.revision.id;
  const build = await fake.startBuild("moonlander-daily", { revisionId: head, boardRevision: "revb" });
  const startedAt = Date.now();
  const timings = { waitMs: 0, buildMs: null, flashMs: null, totalMs: null };
  const auto = { on: true, choice: null, paused: false, proven: true, provenAt: startedAt - 86_400_000, dueAt: null };
  const status = async (): Promise<BoardSync[]> => {
    const now = await fake.getBuild(build.id);
    const running = now === null || now.status === "running";
    const failed = now !== null && now.status === "failed";
    const cli = `build ${build.id} failed: ${now?.error ?? ""} (log: /Users/you/Library/Application Support/keyloom/logs/build-${build.id}.log)`;
    return [{
      boardId: "zsa/moonlander", boardName: "Moonlander", layoutId: "moonlander-daily", layoutName: "Daily driver", headRevisionId: head, otherLayouts: 0, auto,
      state: running ? { kind: "syncing", step: "building", syncId: "sync_1", startedAt, trigger: "auto" } : failed ? { kind: "behind", changes: 1, why: "failed", error: cli } : { kind: "in_sync" },
      last: {
        id: "sync_1", trigger: "auto", status: running ? "building" : failed ? "failed" : "succeeded", step: running ? "building" : "done", revisionId: head,
        failure: failed ? "build" : null, error: failed ? cli : null, errorCode: failed ? now?.errorCode ?? null : null, buildId: build.id, startedAt, finishedAt: running ? null : Date.now(), timings,
      },
    }];
  };
  const refused = (): never => {
    throw new SyncError(400, "busy", "The dev editor's fake sync only shows a failed build.");
  };
  return {
    status, syncNow: refused, setAutoSync: refused, setPaused: refused, disableRemapping: refused, replaceForeignRemapperConfig: refused, confirmExitChord: refused,
    newKeyboards: () => [], setupBoards: () => [],
    subscribe: (listener) => {
      let last = "";
      const tell = () => void status().then((boards) => {
        const now = JSON.stringify(boards.map((b) => b.state));
        if (now !== last) listener(boards, [], []);
        last = now;
      });
      tell();
      const timer = setInterval(tell, 1000);
      return () => clearInterval(timer);
    },
  };
}
console.log(server.url);
