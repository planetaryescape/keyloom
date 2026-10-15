// The subprocess runner (01#firmware-toolchains): Bun.spawn with a log file, a line callback for
// progress, and a timeout that sends SIGTERM and then SIGKILL.
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/** Append-only log file shared by the commands of one build or flash, so its order is the order things happened. */
export class LogSink {
  private fd: number | undefined;
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.fd = openSync(path, "a");
  }

  /** Synchronous, so a line is on disk before the next one is read and a crash loses at most the line in flight. */
  line(text: string): void {
    if (this.fd !== undefined) writeSync(this.fd, `${text}\n`);
  }

  close(): void {
    if (this.fd !== undefined) closeSync(this.fd);
    this.fd = undefined;
  }
}

export type RunOptions = {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  log?: LogSink;
  /** SIGTERM after this long; SIGKILL `killGraceMs` later if it is still running. */
  timeoutMs?: number;
  /** The same, on demand. `signal.reason` is kept in the result. */
  signal?: AbortSignal;
  killGraceMs?: number;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** Runs once when the runner kills the process, before the signal: stops things SIGTERM to the client won't, such as a Docker container. */
  onKill?: () => void | Promise<void>;
};

export type RunResult = {
  /** The exit code, or null when the process died from a signal (see `signalCode`). */
  exitCode: number | null;
  signalCode: string | null;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
};

const DEFAULT_GRACE_MS = 5000;

/** Splits a byte stream into lines on \n, \r\n and \r (build tools redraw progress with \r). */
async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  const flush = (text: string, final: boolean) => {
    pending += text;
    const parts = pending.split(/\r\n|\r|\n/);
    pending = parts.pop() ?? "";
    for (const p of parts) onLine(p);
    if (final && pending !== "") onLine(pending);
  };
  for await (const chunk of stream) flush(decoder.decode(chunk, { stream: true }), false);
  flush(decoder.decode(), true);
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const proc = Bun.spawn(opts.cmd, {
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    ...(opts.env === undefined ? {} : { env: { ...process.env, ...opts.env } }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let aborted = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = async () => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    try {
      await opts.onKill?.();
    } catch {
      // Best effort: the process still gets its signal.
    }
    proc.kill("SIGTERM");
    killTimer = setTimeout(() => proc.kill("SIGKILL"), opts.killGraceMs ?? DEFAULT_GRACE_MS);
  };
  const timeout = opts.timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    void kill();
  }, opts.timeoutMs);
  const onAbort = () => {
    aborted = true;
    void kill();
  };
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });

  const handle = (stream: "stdout" | "stderr") => (line: string) => {
    opts.log?.line(line);
    opts.onLine?.(line, stream);
  };
  try {
    await Promise.all([readLines(proc.stdout, handle("stdout")), readLines(proc.stderr, handle("stderr")), proc.exited]);
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
  return { exitCode: proc.exitCode, signalCode: proc.signalCode, timedOut, aborted, durationMs: Date.now() - started };
}

/** Runs a short command and returns what it printed. */
export async function capture(cmd: string[], opts: Omit<RunOptions, "cmd" | "onLine" | "log"> = {}): Promise<RunResult & { stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const result = await run({ ...opts, cmd, onLine: (line, stream) => (stream === "stdout" ? out : err).push(line) });
  return { ...result, stdout: out.join("\n"), stderr: err.join("\n") };
}
