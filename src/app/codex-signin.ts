// Signing in to Codex from the app (D-496): keyloom runs `codex login`, which opens the browser and waits for ChatGPT's
// callback, and the status says when it is done. keyloom still never reads the ChatGPT credential (D-108); Codex keeps it.
import { type ChildProcess, spawn } from "node:child_process";
import { codexBin } from "../agent/codex/login.ts";

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

export type Spawner = (bin: string, args: string[], env: Env) => ChildProcess;
const realSpawn: Spawner = (bin, args, env) => spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });

export class CodexSignIn {
  private status: CodexSignInState = { state: "idle" };
  private child: ChildProcess | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly run: Spawner = realSpawn, private readonly timeoutMs = SIGN_IN_TIMEOUT_MS) {}

  current(): CodexSignInState {
    return this.status;
  }

  /** Starts `codex login`, or keeps the one already waiting. */
  start(env: Env = process.env): CodexSignInState {
    if (this.child !== null) return this.status;
    const child = this.run(codexBin(env), ["login"], env);
    this.child = child;
    this.status = { state: "waiting", url: null };
    let output = "";
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_192);
      const url = SIGN_IN_URL.exec(output)?.[0] ?? null;
      if (url !== null && this.child === child && this.status.state === "waiting" && this.status.url === null) this.status = { state: "waiting", url };
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    this.timer = setTimeout(() => this.finish(child, { state: "failed", reason: "The sign-in took longer than 10 minutes, so keyloom stopped waiting." }, true), this.timeoutMs);
    child.once("error", (err: NodeJS.ErrnoException) =>
      this.finish(child, { state: "failed", reason: err.code === "ENOENT" ? "The Codex CLI is not installed on this computer." : "Codex couldn't start." }));
    child.once("close", (code) => this.finish(child, code === 0 ? { state: "idle" } : { state: "failed", reason: "Codex didn't finish signing in." }));
    return this.status;
  }

  /** Stops waiting. The browser tab stays, but nothing answers it. */
  cancel(): void {
    if (this.child !== null) this.finish(this.child, { state: "idle" }, true);
    else this.status = { state: "idle" };
  }

  private finish(child: ChildProcess, next: CodexSignInState, kill = false): void {
    if (this.child !== child) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.child = null;
    this.status = next;
    if (kill) child.kill("SIGTERM");
  }
}

let shared: CodexSignIn | undefined;
export const codexSignIn = (): CodexSignIn => (shared ??= new CodexSignIn());
export function useCodexSignIn(next: CodexSignIn | undefined): void {
  shared = next;
}
