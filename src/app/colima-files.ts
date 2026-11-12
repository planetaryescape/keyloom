// Fix Colima's files (D-533): a Colima started with `sudo` leaves ~/.colima, and the socket in it, to root, so Docker refuses this account.
// The fix stops root's copy, gives the files back to the person as root through macOS's password dialog (D-493), and then keyloom starts
// Colima as the person. Only the stop and the ownership change run as root. Every outside command goes through an injected runner, so
// no test stops Colima or asks for a password.
import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { DockerEngine } from "../firmware/toolchain/docker.ts";
import { capture } from "../firmware/toolchain/run.ts";
import { type Runner, adminCommand, lastLine, shellQuote } from "./remapper-setup.ts";

export const COLIMA_FILES_PROMPT = "keyloom wants to stop the copy of Colima that runs as another account and give Colima's files in your home folder back to you, so Docker lets keyloom build firmware.";

/** What the root script works on. Every value is checked before it reaches the script, and each one is quoted there. */
export type ColimaFilesPlan = {
  /** The colima binary, as an absolute path: root's PATH doesn't have Homebrew's folder. */
  colima: string;
  /** The folders root's `colima stop` needs on PATH: colima's own and limactl's. */
  pathDirs: string[];
  /** The person's home folder: root's `colima stop` must read the same ~/.colima the person's Colima uses. */
  home: string;
  /** ~/.colima, the folder whose files go back to the person. */
  colimaHome: string;
  /** The person's numeric user ID: a number needs no quoting and can't name another account by mistake. */
  uid: number;
  /** The Colima profile, from the Docker context, or null for the default. */
  profile: string | null;
};

/** Why the root script stopped. It prints `keyloom colima fix stopped (<code>): <reason>` to stderr before it exits 1. */
export const COLIMA_FIX_FAILURE_CODES = ["colima_dir_missing", "colima_linked_file", "colima_chown_failed"] as const;
export type ColimaFixFailureCode = (typeof COLIMA_FIX_FAILURE_CODES)[number];

/** The last failure line the root script printed, or null when it printed none. osascript wraps stderr in its "execution error" line. */
export function colimaFixFailure(out: string): { code: ColimaFixFailureCode; reason: string } | null {
  let found: { code: ColimaFixFailureCode; reason: string } | null = null;
  for (const m of out.matchAll(/keyloom colima fix stopped \((\w+)\): (.+?)(?: \(\d+\))?$/gm)) {
    const code = COLIMA_FIX_FAILURE_CODES.find((c) => c === m[1]);
    if (code !== undefined && m[2] !== undefined) found = { code, reason: m[2].trim() };
  }
  return found;
}

// Colima's own profile names: letters, digits, dot, dash and underscore. Anything else never reaches the script.
const PROFILE = /^[A-Za-z0-9._-]+$/;

export type PlanDeps = {
  which: (command: string) => string | null;
  home: string;
  uid: number;
  /** What is at a path, without following a symbolic link. */
  kind: (path: string) => "dir" | "symlink" | "missing" | "other";
};

export const realPlanDeps = (): PlanDeps => ({
  which: (command) => Bun.which(command),
  home: homedir(),
  uid: process.getuid?.() ?? -1,
  kind: (path) => {
    try {
      const stat = lstatSync(path);
      return stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "dir" : "other";
    } catch {
      return "missing";
    }
  },
});

/** The plan for this Colima, or the sentence that says why keyloom can't fix it from here. Checked again inside the root script. */
export function colimaFilesPlan(engine: DockerEngine, deps: PlanDeps): { ok: true; plan: ColimaFilesPlan } | { ok: false; reason: string } {
  if (engine.command[0] !== "colima") return { ok: false, reason: `${engine.name} isn't Colima, so keyloom can't fix its files.` };
  const at = engine.command.indexOf("--profile");
  const profile = at < 0 ? null : engine.command[at + 1] ?? null;
  if (profile !== null && !PROFILE.test(profile)) return { ok: false, reason: `keyloom doesn't recognise the Colima profile "${profile}", so it changed nothing.` };
  const colima = deps.which("colima");
  if (colima === null || !isAbsolute(colima)) return { ok: false, reason: "keyloom can't find the colima command, so it can't stop Colima's other copy." };
  if (!Number.isInteger(deps.uid) || deps.uid <= 0) return { ok: false, reason: "keyloom couldn't tell which account to give Colima's files to, so it changed nothing." };
  if (!isAbsolute(deps.home) || deps.home === "/") return { ok: false, reason: "keyloom couldn't find your home folder, so it changed nothing." };
  const colimaHome = join(deps.home, ".colima");
  const kind = deps.kind(colimaHome);
  if (kind !== "dir") {
    return { ok: false, reason: kind === "symlink" ? "~/.colima is a link to another folder, so keyloom won't change its files as an administrator." : "keyloom can't find Colima's folder, ~/.colima, so there are no files to give back." };
  }
  const limactl = deps.which("limactl");
  const pathDirs = [...new Set([dirname(colima), ...(limactl !== null && isAbsolute(limactl) ? [dirname(limactl)] : [])])];
  return { ok: true, plan: { colima, pathDirs, home: deps.home, colimaHome, uid: deps.uid, profile } };
}

/**
 * The root half. It stops the Colima that runs from the person's ~/.colima as root (with HOME set, so root's colima reads that folder,
 * as `sudo env HOME="$HOME" colima stop` did), then gives every file in ~/.colima that isn't the person's back to them. A stop that fails
 * is logged and the rest still runs, as with the command it replaces: a VM that is already down has nothing to stop.
 *
 * Handing files to the person as root is where a mistake gives away more than Colima's files, so:
 * - ~/.colima must be a real folder, not a link, and `find -P` never follows a link inside it; `-xdev` stays on its disk.
 * - `chown -h` changes a link itself, never what it points at, and `-execdir` runs it from the file's own folder, so a folder renamed
 *   during the walk can't send it elsewhere. `-depth` changes a folder only after everything in it.
 * - A file with more than one name can be a root-owned file elsewhere linked in, so the script refuses if one is there and isn't the
 *   person's, and the change skips any that appears later.
 * Every value is quoted, the uid is a number, and nothing in the script comes from the page.
 */
export function colimaFilesScript(plan: ColimaFilesPlan): string {
  if (!Number.isInteger(plan.uid) || plan.uid <= 0) throw new Error("the uid must be a positive integer");
  if (plan.profile !== null && !PROFILE.test(plan.profile)) throw new Error("the Colima profile has characters keyloom doesn't allow");
  const uid = String(plan.uid);
  const dir = shellQuote(plan.colimaHome);
  const profile = plan.profile === null ? "" : ` --profile ${shellQuote(plan.profile)}`;
  const path = [...plan.pathDirs, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].map(shellQuote).join(":");
  return [
    "fail() { echo \"keyloom colima fix stopped ($1): $2\" >&2; exit 1; }",
    `HOME=${shellQuote(plan.home)}; export HOME`,
    `PATH=${path}; export PATH`,
    `dir=${dir}`,
    `if [ -L "$dir" ] || [ ! -d "$dir" ]; then fail colima_dir_missing "Colima's folder isn't a folder keyloom can change, so nothing changed."; fi`,
    `${shellQuote(plan.colima)} stop${profile} || echo "keyloom: the other copy of Colima didn't stop cleanly; giving its files back anyway" >&2`,
    `linked=$(/usr/bin/find -P "$dir" -xdev ! -type d -links +1 ! -user ${uid} -print | /usr/bin/head -n 1)`,
    `if [ -n "$linked" ]; then fail colima_linked_file "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: $linked"; fi`,
    `/usr/bin/find -P "$dir" -xdev -depth ! -user ${uid} \\( -type d -o -links 1 \\) -execdir /usr/sbin/chown -h ${uid} {} + || fail colima_chown_failed "macOS didn't let keyloom give all of Colima's files back to you."`,
  ].join("\n");
}

/** The password dialog stays open until the person answers it; a dialog nobody answers mustn't hold Docker's lock for good. */
const ADMIN_TIMEOUT_MS = 10 * 60_000;

/**
 * Runs the osascript call, refusing under `bun test`, so a forgotten fake fails its test instead of asking for a password. At the deadline
 * osascript is stopped, which closes its dialog, so a password typed later can't run the root steps after the engine lock is gone.
 */
export const adminRunner: Runner = async (cmd) => {
  if (process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS === "1") throw new Error(`refusing to run ${cmd[0]} in a test`);
  const r = await capture([...cmd], { timeoutMs: ADMIN_TIMEOUT_MS });
  if (r.timedOut) return { code: 124, out: "macOS's password dialog stayed open for ten minutes, so keyloom closed it." };
  return { code: r.exitCode ?? 1, out: `${r.stdout}\n${r.stderr}` };
};

export type ColimaRootResult = { ok: true } | { ok: false; code: "cancelled" | ColimaFixFailureCode | "failed"; reason: string };

/** Asks for the administrator password and runs the root half. */
export async function runColimaRootSteps(plan: ColimaFilesPlan, run: Runner): Promise<ColimaRootResult> {
  const r = await run(adminCommand(colimaFilesScript(plan), COLIMA_FILES_PROMPT));
  if (r.code === 0) return { ok: true };
  // osascript reports a cancelled password dialog as error -128.
  if (/-128\b/.test(r.out)) return { ok: false, code: "cancelled", reason: "You cancelled the password dialog, so Colima's files didn't change." };
  const failure = colimaFixFailure(r.out);
  if (failure !== null) return { ok: false, ...failure };
  return { ok: false, code: "failed", reason: `macOS couldn't fix Colima's files: ${lastLine(r.out) || `osascript exited ${r.code}`}` };
}
