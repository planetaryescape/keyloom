// Whether Codex can answer, asked of Codex itself. keyloom never reads or stores the ChatGPT
// credential (D-108); it only learns whether `codex login status` succeeds.
import { spawn } from "node:child_process";

export const codexBin = (env: Record<string, string | undefined> = process.env): string => env.KEYLOOM_CODEX_BIN?.trim() || "codex";

export type CodexLogin = { ready: true } | { ready: false; reason: "not_installed" | "logged_out" };

/** An API key in CODEX_API_KEY switches Codex to API billing and needs no login (19#choosing-a-provider). */
export function checkCodexLogin(env: Record<string, string | undefined> = process.env, timeoutMs = 10_000): Promise<CodexLogin> {
  if (env.CODEX_API_KEY?.trim()) return Promise.resolve({ ready: true });
  return new Promise((resolve) => {
    const child = spawn(codexBin(env), ["login", "status"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
    let output = "";
    // The status line goes to stderr on some versions and stdout on others.
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ ready: false, reason: err.code === "ENOENT" ? "not_installed" : "logged_out" });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && /logged in/i.test(output) ? { ready: true } : { ready: false, reason: "logged_out" });
    });
  });
}
