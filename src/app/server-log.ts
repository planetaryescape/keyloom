// Where keyloom's own output goes, and opening it (R8-09, D-541). The desktop app writes the server's output to a file and names it in
// LOG_FILE_ENV; a server started in a terminal writes to that terminal, which has no file to name.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { capture } from "../firmware/toolchain/run.ts";

/** The variable the desktop app sets on the server it starts: the file it writes the server's output to (desktop/tauri sidecar.rs). */
export const LOG_FILE_ENV = "KEYLOOM_LOG_FILE";

/** The file the desktop app writes keyloom's output to (`canShow`: keyloom can open it, on macOS), or the terminal keyloom runs in. */
export type ServerLog = { kind: "file"; path: string; canShow: boolean } | { kind: "terminal" };

export type ServerLogDeps = { platform?: NodeJS.Platform; open?: (path: string) => Promise<void> };

/** Where this server's log is, from what the desktop app passed. Only an absolute path counts: a relative one would follow the cwd. */
export function serverLog(env: Record<string, string | undefined>, platform: NodeJS.Platform = process.platform): ServerLog {
  const path = env[LOG_FILE_ENV];
  if (path === undefined || path === "" || !isAbsolute(path)) return { kind: "terminal" };
  return { kind: "file", path, canShow: platform === "darwin" };
}

// The log's default app on a Mac is Console, which is what the desktop's own Show log opens (log.rs `show`).
const openFile = async (path: string): Promise<void> => {
  // The test preload sets this, so a forgotten fake fails its test instead of opening Console on the machine.
  if (process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS === "1") throw new Error(`refusing to open ${path} in a test`);
  const r = await capture(["open", path], { timeoutMs: 10_000 });
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).trim() || `open exited with code ${r.exitCode}`);
};

/** Why the log didn't open, coded so the page picks its words and the route its status without reading the sentence. */
export class LogShowError extends Error {
  override name = "LogShowError";
  constructor(readonly code: "log_in_terminal" | "log_unsupported" | "log_open_failed", message: string) {
    super(message);
  }
}

/**
 * Opens the log in its default app. A log the app hasn't written yet is created empty first, as the desktop's own Show log does, so
 * `open` has a file to show.
 */
export async function showServerLog(log: ServerLog, deps: ServerLogDeps = {}): Promise<void> {
  if (log.kind === "terminal") throw new LogShowError("log_in_terminal", "keyloom runs in a terminal, so its log is that terminal's window.");
  if ((deps.platform ?? process.platform) !== "darwin") throw new LogShowError("log_unsupported", `keyloom can open its log on macOS only. It is at ${log.path}.`);
  try {
    mkdirSync(dirname(log.path), { recursive: true });
    appendFileSync(log.path, "");
    await (deps.open ?? openFile)(log.path);
  } catch (error) {
    throw new LogShowError("log_open_failed", `keyloom couldn't open its log: ${error instanceof Error ? error.message : String(error)}. It is at ${log.path}.`);
  }
}
