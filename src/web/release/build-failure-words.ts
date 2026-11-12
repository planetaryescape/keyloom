// What a failed build's step says and offers (R5-02), by the build's code, never its text. Pure, so each case is tested without a browser.
import { type Build, CHAT_MESSAGE_MAX } from "../../api/http.ts";
import { headline } from "../../layout/history-summary.ts";
import { ApiError } from "../api.ts";
import { type GoBackRefusal, goBackRefusal } from "../shell/mismatch-words.ts";

/**
 * `docker`: the Docker callout answers it (D-488). `same_every_time`: the layout doesn't compile or fit, so building again fails the same
 * way; the step offers the last revision that built, when there is one in this revision's history and this is the head, and a question to
 * keyloom. `restart_engine`: the engine's own state stopped it (a stale shared folder, a container it can't remove), so the step offers to
 * restart the engine and build again (R6-09, R6-17). `may_pass`: anything else, such as a download that failed, keeps Build again beside
 * the question.
 */
export type BuildFailureView =
  | { kind: "docker" }
  | { kind: "restart_engine"; text: string; next: string; button: string | null; busy: string | null }
  | { kind: "same_every_time"; next: string; goBack: { revisionId: string; summary: string } | null }
  | { kind: "may_pass" };

/** `restartFailed`: keyloom's own restart of the engine failed, so it isn't offered again (D-511) and the words say what is left. */
export function buildFailureView(build: Pick<Build, "errorCode" | "lastBuilt" | "restartEngine">, earlierRevision: boolean, restartFailed = false): BuildFailureView {
  if (build.errorCode === "docker_unavailable") return { kind: "docker" };
  if (build.errorCode === "stale_mount" || build.errorCode === "stuck_container") return engineRestartView(build.errorCode, build.restartEngine ?? null, restartFailed);
  if (build.errorCode !== "compile_error" && build.errorCode !== "too_large") return { kind: "may_pass" };
  // Going back moves the head; a build of an earlier revision chosen in History has no head to move.
  const goBack = earlierRevision ? null : (build.lastBuilt ?? null);
  const next = goBack === null
    ? "Building it again fails the same way. Ask keyloom about this build, or change the layout and build again."
    : `Building it again fails the same way. The last version that built is “${headline(goBack.summary)}”. Going back adds a new revision, so this one stays in History.`;
  return { kind: "same_every_time", next, goBack };
}

// The build's own sentence names a terminal command and XDG_CACHE_HOME; the page says what happened and offers the restart instead.
function engineRestartView(code: "stale_mount" | "stuck_container", engine: string | null, restartFailed: boolean): BuildFailureView {
  const text = code === "stale_mount"
    ? "Docker kept showing the build an old copy of the files keyloom wrote, so the build stopped before it used them."
    : "A build container that an earlier keyloom left running couldn't be removed, so the build stopped before it started.";
  if (engine !== null && restartFailed) return { kind: "restart_engine", text, next: `keyloom couldn't restart ${engine}. Restart ${engine} yourself, then build again.`, button: null, busy: null };
  if (engine === null) return { kind: "restart_engine", text, next: "Restarting your Docker engine clears this. Restart it, then build again.", button: null, busy: null };
  return { kind: "restart_engine", text, next: `Restarting ${engine} clears this. It stops anything else ${engine} is running.`, button: `Restart ${engine} and build again`, busy: `Restarting ${engine}…` };
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
