// Installing what a build or a flash needs, from a button (D-488, D-489). On a Mac with Homebrew keyloom runs the
// install itself, shows its output while it runs, and for Docker starts the engine afterwards, so the person never
// has to copy a command into a terminal. Everywhere else the UI links the install page instead.
import { BREW_FORMULA } from "../firmware/qmk/dfu-flash.ts";
import { DOCKER_BREW_FORMULAE, type DockerStartResult, colimaEngine, startDockerEngine } from "../firmware/toolchain/docker.ts";
import { run, which } from "../firmware/toolchain/run.ts";

export const INSTALLABLE_TOOLS = ["docker", "zapp", "dfu-util", "dfu-programmer", "avrdude"] as const;
export type InstallableTool = (typeof INSTALLABLE_TOOLS)[number];

/** Each tool's Homebrew formulae. zapp and the DFU tools are all in homebrew-core (`brew info zapp`, checked 2026-11-11). */
export function brewFormulae(tool: InstallableTool): string[] {
  if (tool === "docker") return [...DOCKER_BREW_FORMULAE];
  if (tool === "zapp") return ["zapp"];
  return [BREW_FORMULA[tool]];
}

/** The page that installs a tool by hand, for a computer where keyloom can't. */
export const TOOL_PAGES = {
  zapp: "https://github.com/zsa/zapp",
  "dfu-util": "https://dfu-util.sourceforge.net/",
  "dfu-programmer": "https://github.com/dfu-programmer/dfu-programmer",
  avrdude: "https://github.com/avrdudes/avrdude",
} satisfies Record<Exclude<InstallableTool, "docker">, string>;

export type InstallErrorCode = "no_brew" | "brew_failed" | "start_failed";

export type InstallState = {
  tool: InstallableTool;
  status: "idle" | "running" | "succeeded" | "failed" | "cancelled";
  /** While running: installing the formulae, then (for Docker) starting the engine; `stopping` once the person cancelled it (R2-08). */
  phase: "installing" | "starting" | "stopping" | null;
  /** The last lines of the install's output, oldest first. */
  logTail: string[];
  error: string | null;
  errorCode: InstallErrorCode | null;
};

/** Runs one command and streams its lines; the real one is toolchain/run.ts. Tests pass a fake, so no test runs brew. */
export type InstallRunner = (cmd: string[], opts: { onLine: (line: string) => void; timeoutMs: number; signal?: AbortSignal }) => Promise<{ exitCode: number | null; timedOut: boolean }>;

export type InstallDeps = {
  runner?: InstallRunner;
  has?: (command: string) => boolean;
  platform?: NodeJS.Platform;
  /** Starts Docker after its install; the default starts Colima through the D-486 path. */
  startDocker?: (onLine: (line: string) => void, signal?: AbortSignal) => Promise<DockerStartResult>;
};

/** Whether keyloom can install a tool here by itself: Homebrew on a Mac. */
export function canInstall(deps: Pick<InstallDeps, "has" | "platform"> = {}): boolean {
  const has = deps.has ?? ((c: string) => which(c) !== null);
  return (deps.platform ?? process.platform) === "darwin" && has("brew");
}

// A fresh Homebrew can update itself first, and Colima's first start downloads its VM image: both can take minutes.
const BREW_TIMEOUT_MS = 20 * 60_000;
const COLIMA_START_TIMEOUT_MS = 15 * 60_000;
const TAIL_LINES = 30;

const realRunner: InstallRunner = async (cmd, opts) => {
  // The test preload sets this, so a forgotten fake fails its test instead of installing software on the machine.
  if (process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS === "1") throw new Error(`refusing to run ${cmd.join(" ")} in a test`);
  // Its own process group, so Cancel stops the downloads brew started too, not only brew (R2-08).
  const r = await run({ cmd, timeoutMs: opts.timeoutMs, onLine: (line) => opts.onLine(line), env: { HOMEBREW_NO_ENV_HINTS: "1" }, processGroup: true, ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
  return { exitCode: r.exitCode, timedOut: r.timedOut };
};

export type InstallOutcome = { ok: true } | { ok: false; code: InstallErrorCode | "cancelled"; reason: string };

const CANCELLED: InstallOutcome = { ok: false, code: "cancelled", reason: "The install was stopped." };

/**
 * Installs a tool with Homebrew, and for Docker starts Colima afterwards and waits for it to answer. `onPhase` says
 * when the install moves on to starting the engine. `signal` stops Homebrew or the start where it is (R2-08).
 */
export async function installTool(tool: InstallableTool, onLine: (line: string) => void, deps: InstallDeps = {}, onPhase?: (phase: "installing" | "starting") => void, signal?: AbortSignal): Promise<InstallOutcome> {
  const runner = deps.runner ?? realRunner;
  if (!canInstall(deps)) {
    return { ok: false, code: "no_brew", reason: "keyloom installs this with Homebrew, and Homebrew isn't on this computer." };
  }
  onPhase?.("installing");
  const formulae = brewFormulae(tool);
  onLine(`keyloom: brew install ${formulae.join(" ")}`);
  let result: Awaited<ReturnType<InstallRunner>>;
  try {
    result = await runner(["brew", "install", ...formulae], { onLine, timeoutMs: BREW_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) });
  } catch (err) {
    if (signal?.aborted) return CANCELLED;
    return { ok: false, code: "brew_failed", reason: `Homebrew couldn't start: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (signal?.aborted) return CANCELLED;
  if (result.exitCode !== 0) {
    return { ok: false, code: "brew_failed", reason: result.timedOut ? "Homebrew didn't finish within 20 minutes." : `Homebrew stopped with exit code ${result.exitCode ?? "unknown"}.` };
  }
  if (tool !== "docker") return { ok: true };

  onPhase?.("starting");
  const start = deps.startDocker ?? ((say: (line: string) => void, stop?: AbortSignal) => startColima(runner, say, stop));
  const started = await start(onLine, signal);
  if (signal?.aborted) return CANCELLED;
  return started.ok ? { ok: true } : { ok: false, code: "start_failed", reason: started.reason };
}

/** Starts the Colima just installed. Its first start downloads a VM image, so it gets far longer than a restart. */
function startColima(runner: InstallRunner, onLine: (line: string) => void, signal?: AbortSignal): Promise<DockerStartResult> {
  return startDockerEngine({
    ...(signal === undefined ? {} : { signal }),
    // A fresh docker CLI points at the default socket, which names no engine; the one just installed is Colima.
    detect: async () => {
      const engine = await colimaEngine(null);
      if (engine === null) return { kind: "none" };
      // Its hint is a terminal command; after an install the page offers Start it now and the CLI names --start-docker instead.
      const { hint: _hint, ...bare } = engine;
      return { kind: "engine", engine: bare };
    },
    start: async (engine, _budgetMs, stop) => {
      const r = await runner(engine.command, { onLine, timeoutMs: COLIMA_START_TIMEOUT_MS, ...(stop === undefined ? {} : { signal: stop }) });
      return r.exitCode === 0 ? { ok: true } : { ok: false, detail: r.timedOut ? "it did not start in time" : `it exited with code ${r.exitCode ?? "unknown"}` };
    },
    timeoutMs: COLIMA_START_TIMEOUT_MS + 60_000,
    onProgress: onLine,
  });
}

/**
 * One install per tool at a time, held in memory: a second click joins the one running, and the page polls `get`
 * for its output. A server restart forgets a finished install, which is fine: the readiness check then says what is there.
 * `cancel` stops a running one; it stays `running` in phase `stopping` until Homebrew has exited, so a new start can't overlap it.
 */
export function installJobs(deps: InstallDeps = {}) {
  const states = new Map<InstallableTool, InstallState>();
  const controllers = new Map<InstallableTool, AbortController>();
  const finished = new Map<InstallableTool, Promise<void>>();
  const idle = (tool: InstallableTool): InstallState => ({ tool, status: "idle", phase: null, logTail: [], error: null, errorCode: null });
  const get = (tool: InstallableTool): InstallState => {
    const state = states.get(tool) ?? idle(tool);
    return { ...state, logTail: [...state.logTail] };
  };
  const start = (tool: InstallableTool): InstallState => {
    if (states.get(tool)?.status === "running") return get(tool);
    const state: InstallState = { ...idle(tool), status: "running", phase: "installing" };
    states.set(tool, state);
    const controller = new AbortController();
    controllers.set(tool, controller);
    const onLine = (line: string) => {
      if (line.trim() === "") return;
      state.logTail.push(line);
      if (state.logTail.length > TAIL_LINES) state.logTail.splice(0, state.logTail.length - TAIL_LINES);
    };
    const ended = installTool(tool, onLine, deps, (phase) => { if (!controller.signal.aborted) state.phase = phase; }, controller.signal)
      .catch((err: unknown): InstallOutcome => ({ ok: false, code: "brew_failed", reason: err instanceof Error ? err.message : String(err) }))
      .then((outcome) => {
        controllers.delete(tool);
        state.phase = null;
        // A cancelled install ends cancelled even when Homebrew finished first: the person asked it to stop.
        if (controller.signal.aborted) state.status = "cancelled";
        else if (outcome.ok) state.status = "succeeded";
        else Object.assign(state, { status: "failed", error: outcome.reason, errorCode: outcome.code });
      });
    finished.set(tool, ended);
    return get(tool);
  };
  const cancel = (tool: InstallableTool): InstallState => {
    const controller = controllers.get(tool);
    const state = states.get(tool);
    if (controller !== undefined && state?.status === "running" && !controller.signal.aborted) {
      state.phase = "stopping";
      state.logTail.push("keyloom: stopping the install");
      controller.abort();
    }
    return get(tool);
  };
  /**
   * Stops every running install and waits for each to end. Homebrew runs in its own process group, so the server's own exit doesn't stop
   * it: a shutdown that skipped this would leave it installing with nobody to report to (R2-08).
   */
  const cancelAll = async (): Promise<void> => {
    for (const tool of controllers.keys()) cancel(tool);
    await Promise.all(finished.values());
  };
  return { start, get, cancel, cancelAll };
}
export type InstallJobs = ReturnType<typeof installJobs>;
