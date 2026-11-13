// What a failed build's step says and offers (R5-02), by the build's code, never its text. Pure, so each case is tested without a browser.
import { type Build, BuildSchema, CHAT_MESSAGE_MAX } from "../../api/http.ts";
import { headline } from "../../layout/history-summary.ts";
import { ApiError } from "../api.ts";
import { type GoBackRefusal, goBackRefusal } from "../shell/mismatch-words.ts";
import { type PageFailure, wayOutFor } from "../shell/unexpected.ts";
import { COLIMA_HELP_URL, plain } from "./release-words.ts";

/**
 * `docker`: the Docker callout answers it (D-488). `same_every_time`: the layout doesn't compile or fit, so building again fails the same
 * way; the step offers the last revision that built, when there is one in this revision's history and this is the head, and a question to
 * keyloom. `restart_engine`: the engine's own state stopped it (a stale shared folder, a container it can't remove), so the step offers to
 * restart the engine and build again (R6-09, R6-17). `may_pass`: anything else, such as a download that failed, keeps Build again beside
 * the question. `folder_not_shared`: the engine doesn't share keyloom's build folder (R7-02); the step says which folder and where it is
 * shared, with `openApp` (Docker Desktop, whose settings hold its file sharing) or `helpUrl` (Colima's own page on its mounts), and Build
 * again for after it is shared. `disk_full`: Docker's disk is full, so the step offers to free Docker's build cache, then Build again (R8-04).
 */
export type BuildFailureView =
  | { kind: "docker" }
  | { kind: "disk_full"; text: string; next: string }
  | { kind: "folder_not_shared"; text: string; next: string; openApp: "docker_desktop" | null; helpUrl: string | null }
  /** `command`: on Linux, the line that restarts the engine, which keyloom can't run itself (R11-10); null where `button` restarts it. */
  | { kind: "restart_engine"; text: string; next: string; button: string | null; busy: string | null; command: string | null }
  | { kind: "same_every_time"; code: "compile_error" | "too_large" | "source_error"; next: string; goBack: { revisionId: string; summary: string } | null }
  | { kind: "may_pass" };

/**
 * Where keyloom runs, for an engine it can't restart itself (R11-10): `linux`, and `engine`, the engine a ready Docker names ("Docker
 * Desktop", "Rancher Desktop", or "Docker" for the system service).
 */
export type BuildHost = { linux: boolean; engine: string | null };

/** `restartFailed`: keyloom's own restart of the engine failed, so it isn't offered again (D-511) and the words say what is left. */
export function buildFailureView(build: Pick<Build, "errorCode" | "lastBuilt" | "restartEngine" | "folderNotShared">, earlierRevision: boolean, restartFailed = false, host: BuildHost = { linux: false, engine: null }): BuildFailureView {
  if (build.errorCode === "docker_unavailable") return { kind: "docker" };
  if (build.errorCode === "stale_mount" || build.errorCode === "stuck_container") return engineRestartView(build.errorCode, build.restartEngine ?? null, restartFailed, host);
  if (build.errorCode === "folder_not_shared") return folderView(build.folderNotShared ?? null);
  if (build.errorCode === "disk_full") return { kind: "disk_full", text: DISK_FULL_TEXT, next: DISK_FULL_NEXT };
  if (build.errorCode !== "compile_error" && build.errorCode !== "too_large" && build.errorCode !== "source_error") return { kind: "may_pass" };
  // Going back moves the head; a build of an earlier revision chosen in History has no head to move.
  const goBack = earlierRevision ? null : (build.lastBuilt ?? null);
  const next = goBack === null
    ? "Building it again fails the same way. Ask keyloom about this build, or change the layout and build again."
    : `Building it again fails the same way. The last version that built is “${headline(goBack.summary)}”. Going back adds a new revision, so this one stays in History.`;
  return { kind: "same_every_time", code: build.errorCode, next, goBack };
}

// The build's own sentence names a terminal command and XDG_CACHE_HOME; the page says what happened and offers the restart instead.
function engineRestartView(code: "stale_mount" | "stuck_container", engine: string | null, restartFailed: boolean, host: BuildHost): BuildFailureView {
  const text = code === "stale_mount"
    ? "Docker kept showing the build an old copy of the files keyloom wrote, so the build stopped before it used them."
    : "A build container that an earlier keyloom left running couldn't be removed, so the build stopped before it started.";
  // Build again starts the engine itself when it is down (ensureDocker), so the way on is that button, never a terminal (R7-03).
  if (engine !== null && restartFailed) return { kind: "restart_engine", text, next: `keyloom couldn't restart ${engine}. Build again starts ${engine} if it isn't running.`, button: null, busy: null, command: null };
  if (engine === null && host.linux) return { kind: "restart_engine", text, ...linuxRestart(host.engine) };
  if (engine === null) return { kind: "restart_engine", text, next: "Restarting your Docker engine clears this. Restart it, then build again.", button: null, busy: null, command: null };
  return { kind: "restart_engine", text, next: `Restarting ${engine} clears this. It stops anything else ${engine} is running.`, button: `Restart ${engine} and build again`, busy: `Restarting ${engine}…`, command: null };
}

/**
 * Linux's engines keyloom doesn't restart (R11-10, the R8 root limit): the system service needs root, which keyloom never asks for, and
 * keyloom's forced restart knows only Colima and the Mac apps. So the step names the engine and the one line that restarts it, with Copy.
 */
function linuxRestart(engine: string | null) {
  const service = engine === "Docker Desktop" ? "docker-desktop" : engine === "Rancher Desktop" ? "rancher-desktop" : null;
  if (service !== null) {
    return { next: `Restarting ${engine} clears this, and keyloom can't restart it from here. Run this in a terminal, then build again. It stops anything else ${engine} is running.`, button: null, busy: null, command: `systemctl --user restart ${service}` };
  }
  return { next: "Restarting the Docker service clears this. It needs your password, so keyloom doesn't run it. Run this in a terminal, then build again. It stops anything else Docker is running.", button: null, busy: null, command: "sudo systemctl restart docker" };
}

const DISK_FULL_TEXT = "Docker ran out of disk space, so the build stopped.";
// The build's sentence names `docker builder prune`, which the CLI keeps; the page runs it (R8-04).
const DISK_FULL_NEXT = "Freeing Docker's build cache makes room. Nothing you made is removed, but the next build takes longer while Docker rebuilds what it had cached.";

/**
 * What freeing Docker's build cache ended in, for the disk_full step (R8-04). `again`: the button stays, because the next press can work
 * (a build or flash was running, or keyloom was busy with Docker). Otherwise Build again is the way on now.
 */
/**
 * `openApp`: the way to make room is in Docker Desktop's settings, which the step opens (R9-07). `failure`: the prune's request failed no
 * way the page planned for, so the step shows Restart keyloom, and the log for an exception, beside it (D-540).
 */
export type CachePruneOutcome = { text: string; again: boolean; openApp?: "docker_desktop"; failure?: PageFailure };

/**
 * `lead`, then the other ways to make room, named for the engine: Docker Desktop's limit is in its own Settings, which the step opens
 * (R9-07). The prune button goes, because pressing it again ends the same way.
 */
function makeRoom(lead: string, engine: string | null): CachePruneOutcome {
  if (engine === "Docker Desktop") {
    return { text: `${lead} Make room in Docker's disk another way: raise the disk usage limit in Docker Desktop's Settings, under Resources, or remove images you no longer use, then build again.`, again: false, openApp: "docker_desktop" };
  }
  return { text: `${lead} Make room in Docker's disk another way: raise its disk limit in your Docker engine's settings, or remove images you no longer use, then build again.`, again: false };
}

/** `engine`: the Docker engine readiness names, such as "Docker Desktop" or "Colima", or null when keyloom doesn't know it. */
export function cachePruneOutcome(
  result: { ok: true; freed: string | null } | { ok: false; reason: string; code?: string | undefined } | { ok: false; unreachable: true } | { ok: false; failure: PageFailure },
  engine: string | null = null,
): CachePruneOutcome {
  if ("unreachable" in result) return { text: "keyloom didn't answer, so Docker's build cache may not have been freed. Free Docker's build cache again.", again: true };
  if ("failure" in result) {
    // The request itself failed, so the prune never ran and making room another way isn't the answer yet. An exception may pass on a
    // second press; an answer this page can't read fails the same way, so only Restart keyloom is offered for it (R9-07, D-540).
    const way = wayOutFor(result.failure, true);
    if (way !== null) return { text: result.failure.message, again: way.retry, failure: result.failure };
    return makeRoom(plain(result.failure.message).replace(/\.?$/, "."), engine);
  }
  if (!result.ok) {
    // A running build or flash, or a start or restart of Docker, ends by itself; any other failure would fail the same way again.
    if (result.code === "build_running" || result.code === "engine_busy") return { text: plain(result.reason), again: true };
    // Docker only needs starting, and the build starts it (ensureDocker); the disk may still be full then, and the step says so again.
    if (result.code === "docker_unavailable") return { text: "Docker isn't running, so its build cache wasn't freed. Build again starts Docker.", again: false };
    return makeRoom(plain(result.reason).replace(/\.?$/, "."), engine);
  }
  if (result.freed !== null && /^0(\.0+)?[kKMGTP]?i?B$/.test(result.freed)) {
    return makeRoom("Docker's build cache was already empty, so nothing was freed.", engine);
  }
  const freed = result.freed === null ? "Docker freed its build cache." : `Freed ${result.freed} of Docker's build cache.`;
  return { text: `${freed} Build again to continue; it takes longer this time.`, again: false };
}

/**
 * What the sync pill and its toast say about a sync whose build failed (R8-01), from the build's code, never its sentence: the sync's error
 * is the CLI's, with its commands and log path. The way on is Build and flash, which opens on that build with its buttons.
 */
export function syncBuildFailureLine(code: string | null | undefined): string {
  const view = buildFailureView({ errorCode: isBuildCode(code) ? code : null, lastBuilt: null, restartEngine: null, folderNotShared: null }, false);
  switch (view.kind) {
    case "docker": return "Docker isn't ready, so keyloom couldn't build the change. Build and flash shows what Docker needs, with a button to fix it.";
    case "disk_full": return `${view.text} Build and flash can free Docker's build cache.`;
    case "restart_engine": return `${view.text} Build and flash shows how to clear it.`;
    case "folder_not_shared": return `${view.text} Build and flash says where to share it.`;
    case "same_every_time": return `${SAME_EVERY_TIME[view.code]} Building it again fails the same way. Build and flash shows the error, and can ask keyloom about it.`;
    case "may_pass": return code === "cancelled" ? "The build was stopped before it finished, so nothing changed on the keyboard." : "The firmware build failed. Build and flash shows its log and can build it again.";
  }
}

const SAME_EVERY_TIME = {
  compile_error: "The firmware didn't compile from this layout.",
  too_large: "The firmware is too big for the keyboard's memory.",
  source_error: "keyloom couldn't write this layout as the firmware's source.",
} as const;

// The sync sends the build's code as a plain string, so one this page doesn't know reads as no code.
const BUILD_CODES: readonly string[] = BuildSchema.shape.errorCode.unwrap().options;
const isBuildCode = (code: string | null | undefined): code is NonNullable<Build["errorCode"]> => BUILD_CODES.includes(code ?? "");

/** Colima's FAQ entry on a bind mount outside the home folder, which says to add it to `mounts` (checked 2026-11-12). */
export const COLIMA_MOUNTS_URL = `${COLIMA_HELP_URL}#docker-bind-mount-showing-empty`;

// The build's own sentence names XDG_CACHE_HOME, which the CLI keeps; the page names the folder and where the engine shares it (R7-02).
function folderView(found: { folder: string; engine: string | null } | null): BuildFailureView {
  const folder = found?.folder ?? null;
  const where = folder === null ? "the folder keyloom builds in" : `the folder keyloom builds in (${folder})`;
  const text = `Docker can't see ${where}, so the build stopped before it started.`;
  const engine = found?.engine ?? null;
  if (engine === "Docker Desktop") return { kind: "folder_not_shared", text, next: "Add that folder in Docker Desktop's Settings, under Resources > File sharing, then build again.", openApp: "docker_desktop", helpUrl: null };
  if (engine === "Colima") return { kind: "folder_not_shared", text, next: "Colima shares only your home folder unless you add more. Add that folder to Colima's mounts, then build again.", openApp: null, helpUrl: COLIMA_MOUNTS_URL };
  return { kind: "folder_not_shared", text, next: `Share that folder with ${engine ?? "your Docker engine"}, then build again.`, openApp: null, helpUrl: null };
}

/**
 * What the step says while a restart waits for work to end (R7-04): "Restarts Colima when the lab analysis ends, then builds again." The
 * server names each piece of work with its article ("a lab analysis"), so the words say "the" for the one running now.
 */
export function restartWaitText(engine: string | null, waitingFor: readonly string[]): string {
  const names = waitingFor.map((name) => name.replace(/^an? /, "the "));
  const list = names.length <= 1 ? (names[0] ?? "that work") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Restarts ${engine ?? "Docker"} when ${list} ${names.length > 1 ? "end" : "ends"}, then builds again.`;
}

/** The log lines a restart_engine step shows: without keyloom's closing "build failed" line, which repeats the terminal advice. */
export const engineRestartLog = (lines: readonly string[]): string[] => lines.filter((line) => !line.startsWith("keyloom: build failed:"));

// The log keeps its newest lines within what a chat message may hold. The error and each line are capped first, so one huge line or
// error (or board name) can never push the whole log out: with these caps, the heading and the newest line always fit.
const MAX_REQUEST = CHAT_MESSAGE_MAX;
const MAX_LOG_LINES = 60;
const MAX_ERROR = 2000;
const MAX_LINE = 1000;
const MAX_BOARD_NAME = 200;
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** The question "Ask keyloom about this build" puts in the chat for the person to check and send: what failed and the log's last lines. */
export function buildQuestion(input: { boardName: string; error: string | null; logTail: readonly string[] }): string {
  const head = [
    `My firmware build for the ${clip(input.boardName, MAX_BOARD_NAME)} failed. Explain what went wrong in plain words, and what I can change in my layout so it builds.`,
    `keyloom said: ${clip(input.error ?? "The build failed.", MAX_ERROR)}`,
    "The last lines of the build log:",
  ].join("\n\n");
  const lines = input.logTail.slice(-MAX_LOG_LINES).map((line) => clip(line, MAX_LINE));
  // Drop the oldest lines until the whole request fits; the newest lines carry the error, so the newest one always stays.
  let start = 0;
  const fenced = (from: number) => `${head}\n\n\`\`\`\n${lines.slice(from).join("\n")}\n\`\`\``;
  while (start < lines.length - 1 && fenced(start).length > MAX_REQUEST) start++;
  return fenced(start);
}

/** A refused Go back, for the build it was refused on. `retry`: the request may pass if asked again, so the button stays. */
export type GoBackProblem = GoBackRefusal & { buildId: string | null; retry: boolean };

export function goBackProblem(problem: unknown, buildId: string | null): GoBackProblem {
  if (!(problem instanceof ApiError)) return { text: problem instanceof Error ? problem.message : "keyloom couldn't go back.", next: null, buildId, retry: true };
  // A request that never reached keyloom, or a server fault, may pass on a second try. Asking again is safe: the undo names the head it
  // read, so a repeat of one that did land is refused as stale and offers the latest version instead.
  return { ...goBackRefusal(problem.code, problem.message), buildId, retry: problem.code === "unreachable" || problem.status >= 500 };
}

/** A refusal belongs to one build, so a later build never shows an older build's refusal. */
export function shownGoBackProblem(problem: GoBackProblem | null, lastBuildId: string | null): GoBackProblem | null {
  return problem !== null && problem.buildId === lastBuildId ? problem : null;
}

/** A Go back that worked: the build it answered, the head it left, and the head it made, once the page has read it. */
export type WentBack = { summary: string; buildId: string | null; fromHead: string; toHead: string | null };

/** The first head after a Go back is the revision it made; a later edit moves the head on, and the "back to" line no longer fits. */
export function wentBackSummary(wentBack: WentBack | null, lastBuildId: string | null, headId: string): string | null {
  return wentBack !== null && wentBack.buildId === lastBuildId && wentBack.toHead === headId ? wentBack.summary : null;
}
