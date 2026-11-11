// Signing in to Codex from the app (D-496): keyloom runs `codex login`, which opens the browser and waits for ChatGPT's
// callback, and the status says when it is done. keyloom still never reads the ChatGPT credential (D-108); Codex keeps it.
import { codexBin } from "../agent/codex/login.ts";
import { run } from "../firmware/toolchain/run.ts";

type Env = Record<string, string | undefined>;

export type CodexSignInState =
  | { state: "idle" }
  /** `url` is the sign-in page Codex printed, for when the browser didn't open; null until it prints one. */
  | { state: "waiting"; url: string | null }
  | { state: "failed"; reason: string };

/** Long enough to sign in, with two-factor; short enough that a forgotten tab doesn't keep a listener open all day. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
// Only OpenAI's sign-in page is passed on, so a stray URL in Codex's output never becomes a link in the app.
const SIGN_IN_URL = /https:\/\/auth\.openai\.com\/\S+/;

export class CodexSignIn {
  private status: CodexSignInState = { state: "idle" };
  /** Aborting it stops the waiting `codex login`, with SIGKILL if SIGTERM isn't enough. */
  private abort: AbortController | null = null;

  constructor(private readonly timeoutMs = SIGN_IN_TIMEOUT_MS) {}

  current(): CodexSignInState {
    return this.status;
  }

  /** Starts `codex login`, or keeps the one already waiting. */
  start(env: Env = process.env): CodexSignInState {
    if (this.abort !== null) return this.status;
    const abort = new AbortController();
    this.abort = abort;
    this.status = { state: "waiting", url: null };
    const settle = (next: CodexSignInState) => {
      if (this.abort !== abort) return;
      this.abort = null;
      this.status = next;
    };
    void run({
      cmd: [codexBin(env), "login"],
      env,
      signal: abort.signal,
      timeoutMs: this.timeoutMs,
      onLine: (line) => {
        const url = SIGN_IN_URL.exec(line)?.[0];
        if (url !== undefined && this.abort === abort && this.status.state === "waiting" && this.status.url === null) this.status = { state: "waiting", url };
      },
    }).then(
      (result) => settle(
        result.exitCode === 0 ? { state: "idle" }
        : result.timedOut ? { state: "failed", reason: "The sign-in took longer than 10 minutes, so keyloom stopped waiting." }
        : { state: "failed", reason: "Codex didn't finish signing in." },
      ),
      // `run` throws only when the program isn't there.
      () => settle({ state: "failed", reason: "The Codex CLI is not installed on this computer." }),
    );
    return this.status;
  }

  /** Stops waiting. The browser tab stays, but nothing answers it. */
  cancel(): void {
    const abort = this.abort;
    this.abort = null;
    this.status = { state: "idle" };
    abort?.abort();
  }
}

let shared: CodexSignIn | undefined;
export const codexSignIn = (): CodexSignIn => (shared ??= new CodexSignIn());
export function useCodexSignIn(next: CodexSignIn | undefined): void {
  shared = next;
}
