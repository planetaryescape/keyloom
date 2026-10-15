// Pinned firmware checkouts (01#firmware-toolchains): the repo at an exact SHA, with only the
// submodules a build needs. keyloom clones on first use, verifies HEAD against the pin on every
// use, and refuses to build from a checkout that doesn't match.
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { type LogSink, capture, run } from "./run.ts";

export type CheckoutSpec = {
  dir: string;
  repo: string;
  sha: string;
  /** Submodule paths to initialise, shallow. */
  submodules: readonly string[];
};

export class CheckoutError extends Error {
  override name = "CheckoutError";
}

export type CheckoutState =
  | { present: false }
  | { present: true; head: string; pinned: boolean; uninitialised: string[]; drifted: string[] };

const git = (dir: string, ...args: string[]) => ["git", "-C", dir, ...args];

export async function checkoutState(spec: CheckoutSpec): Promise<CheckoutState> {
  if (!existsSync(`${spec.dir}/.git`)) return { present: false };
  const head = await capture(git(spec.dir, "rev-parse", "HEAD"), { timeoutMs: 15_000 });
  if (head.exitCode !== 0) throw new CheckoutError(`${spec.dir} is not a usable git checkout: ${head.stderr.trim()}`);
  // With no pathspec, `git submodule status` lists every submodule, which is not what an empty list means.
  const status = spec.submodules.length === 0 ? { stdout: "" } : await capture(git(spec.dir, "submodule", "status", "--", ...spec.submodules), { timeoutMs: 30_000 });
  const uninitialised: string[] = [];
  const drifted: string[] = [];
  for (const line of status.stdout.split("\n")) {
    // `-` not initialised, `+` checked out at a commit other than the one the superproject records.
    const m = /^([-+ U])\S+\s+(\S+)/.exec(line);
    if (m?.[1] === "-") uninitialised.push(m[2] as string);
    else if (m?.[1] === "+" || m?.[1] === "U") drifted.push(m[2] as string);
  }
  return { present: true, head: head.stdout.trim(), pinned: head.stdout.trim() === spec.sha, uninitialised, drifted };
}

type Hooks = { log?: LogSink; onLine?: (line: string) => void; signal?: AbortSignal; timeoutMs?: number };

async function step(cmd: string[], what: string, hooks: Hooks, cwd?: string): Promise<void> {
  const tail: string[] = [];
  const r = await run({
    cmd,
    ...(cwd === undefined ? {} : { cwd }),
    ...(hooks.log ? { log: hooks.log } : {}),
    ...(hooks.signal ? { signal: hooks.signal } : {}),
    timeoutMs: hooks.timeoutMs ?? 30 * 60_000,
    // git prints progress on stderr; it is useful in the log and in a progress view.
    onLine: (line) => {
      tail.push(line);
      if (tail.length > 10) tail.shift();
      hooks.onLine?.(line);
    },
  });
  if (r.exitCode !== 0) throw new CheckoutError(`${what} failed (${r.timedOut ? "timed out" : `exit ${r.exitCode ?? r.signalCode}`}): ${tail.slice(-3).join(" | ")}`);
}

/**
 * Makes `spec.dir` a checkout of `spec.sha` with its submodules, creating it if it isn't there.
 * A first clone happens in a sibling directory and is renamed into place, so an interrupted one
 * leaves nothing that looks like a checkout.
 */
export async function ensureCheckout(spec: CheckoutSpec, hooks: Hooks = {}): Promise<void> {
  const say = (line: string) => {
    hooks.log?.line(line);
    hooks.onLine?.(line);
  };
  let state = await checkoutState(spec);
  if (!state.present) {
    if (existsSync(spec.dir)) throw new CheckoutError(`${spec.dir} exists but is not a git checkout; move it away so keyloom can create one`);
    say(`keyloom: creating ${spec.dir} from ${spec.repo} at ${spec.sha}`);
    const tmp = `${spec.dir}.partial-${process.pid}`;
    await rm(tmp, { recursive: true, force: true });
    await mkdir(dirname(spec.dir), { recursive: true });
    try {
      await step(["git", "init", "--quiet", tmp], "git init", hooks);
      await step(git(tmp, "remote", "add", "origin", spec.repo), "git remote add", hooks);
      // Fetching one commit by SHA keeps history out; GitHub allows it.
      await step(git(tmp, "fetch", "--depth", "1", "--progress", "origin", spec.sha), `fetching ${spec.sha}`, hooks);
      await step(git(tmp, "-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", spec.sha), "git checkout", hooks);
      await rename(tmp, spec.dir);
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      throw err;
    }
    state = await checkoutState(spec);
  }
  if (!state.present) throw new CheckoutError(`${spec.dir} was not created`);
  if (!state.pinned) {
    throw new CheckoutError(
      `${spec.dir} is at ${state.head}, but the board pins ${spec.sha}. keyloom won't build from a checkout that doesn't match; delete the directory and it will be recreated.`,
    );
  }
  if (state.drifted.length > 0) throw new CheckoutError(`submodules ${state.drifted.join(", ")} in ${spec.dir} are not at the commits the pin records; delete the directory and it will be recreated`);
  if (state.uninitialised.length > 0) {
    say(`keyloom: fetching submodules ${state.uninitialised.join(", ")}`);
    await step(git(spec.dir, "submodule", "update", "--init", "--depth", "1", "--progress", "--", ...state.uninitialised), "git submodule update", hooks);
    const after = await checkoutState(spec);
    if (after.present && (after.uninitialised.length > 0 || after.drifted.length > 0)) {
      throw new CheckoutError(`submodules are still not at the pinned commits after update: ${[...after.uninitialised, ...after.drifted].join(", ")}`);
    }
  }
}
