// What a failed build's step says and offers (R5-02), by the build's code, never its text. Pure, so each case is tested without a browser.
import { type Build, CHAT_MESSAGE_MAX } from "../../api/http.ts";
import { headline } from "../../layout/history-summary.ts";

/**
 * `docker`: the Docker callout answers it (D-488). `same_every_time`: the layout doesn't compile or fit, so building again fails the same
 * way; the step offers the last revision that built, when there is one in this revision's history and this is the head, and a question to
 * keyloom. `may_pass`: anything else, such as a download that failed, keeps Build again beside the question.
 */
export type BuildFailureView =
  | { kind: "docker" }
  | { kind: "same_every_time"; next: string; goBack: { revisionId: string; summary: string } | null }
  | { kind: "may_pass" };

export function buildFailureView(build: Pick<Build, "errorCode" | "lastBuilt">, earlierRevision: boolean): BuildFailureView {
  if (build.errorCode === "docker_unavailable") return { kind: "docker" };
  if (build.errorCode !== "compile_error" && build.errorCode !== "too_large") return { kind: "may_pass" };
  // Going back moves the head; a build of an earlier revision chosen in History has no head to move.
  const goBack = earlierRevision ? null : (build.lastBuilt ?? null);
  const next = goBack === null
    ? "Building it again fails the same way. Ask keyloom about this build, or change the layout and build again."
    : `Building it again fails the same way. The last version that built is “${headline(goBack.summary)}”. Going back adds a new revision, so this one stays in History.`;
  return { kind: "same_every_time", next, goBack };
}

// The log keeps its newest lines within what a chat message may hold.
const MAX_REQUEST = CHAT_MESSAGE_MAX;
const MAX_LOG_LINES = 60;

/** The question "Ask keyloom about this build" puts in the chat for the person to check and send: what failed and the log's last lines. */
export function buildQuestion(input: { boardName: string; error: string | null; logTail: readonly string[] }): string {
  const head = [
    `My firmware build for the ${input.boardName} failed. Explain what went wrong in plain words, and what I can change in my layout so it builds.`,
    `keyloom said: ${input.error ?? "The build failed."}`,
    "The last lines of the build log:",
  ].join("\n\n");
  const lines = input.logTail.slice(-MAX_LOG_LINES);
  // Drop the oldest lines until the whole request fits; the newest lines carry the error.
  let start = 0;
  const fenced = (from: number) => `${head}\n\n\`\`\`\n${lines.slice(from).join("\n")}\n\`\`\``;
  while (start < lines.length && fenced(start).length > MAX_REQUEST) start++;
  const text = fenced(start);
  return text.length <= MAX_REQUEST ? text : text.slice(0, MAX_REQUEST);
}
