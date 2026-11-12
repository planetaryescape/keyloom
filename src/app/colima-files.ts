// Fix Colima's files (D-533): a Colima started with `sudo` leaves ~/.colima, and the socket in it, to root, so Docker refuses this account.
// The fix gives the files back to the person as root through macOS's password dialog (D-493), and then keyloom stops and starts Colima as
// the person. Only the ownership change runs as root, and it runs only macOS's own tools: nothing the person's account can replace runs as
// root. Every outside command goes through an injected runner, so no test stops Colima or asks for a password.
import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { DockerEngine } from "../firmware/toolchain/docker.ts";
import { capture } from "../firmware/toolchain/run.ts";
import { type Runner, adminCommand, lastLine, shellQuote } from "./remapper-setup.ts";

export const COLIMA_FILES_PROMPT = "keyloom wants to give Colima's files in your home folder back to you, so Docker lets keyloom build firmware.";

/** What the root script works on. Every value is checked before it reaches the script, and each one is quoted there. */
export type ColimaFilesPlan = {
  /** ~/.colima in the account's own home folder, with no link in its path: the folder whose files go back to the person. */
  colimaHome: string;
  /** The person's numeric user ID: a number needs no quoting and can't name another account by mistake. */
  uid: number;
  /** The Colima profile, from the Docker context, or null for the default. */
  profile: string | null;
};

/** Why the root script stopped. It prints `keyloom colima fix stopped (<code>): <reason>` to stderr before it exits 1. */
export const COLIMA_FIX_FAILURE_CODES = ["colima_dir_missing", "colima_vm_running", "colima_linked_file", "colima_chown_failed"] as const;
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
  /** The home folder keyloom runs with ($HOME), as a real path. Colima keeps its files under it. */
  home: string;
  /** The home folder in this account's record, as a real path, or null when keyloom can't read it. */
  accountHome: string | null;
  uid: number;
  /** What is at a path, without following a symbolic link. */
  kind: (path: string) => "dir" | "symlink" | "missing" | "other";
};

export const realPlanDeps = (): PlanDeps => {
  const uid = process.getuid?.() ?? -1;
  return {
    // Real paths, because the script checks that it is in this exact folder before it changes anything.
    home: realPath(homedir()),
    accountHome: accountHome(uid),
    uid,
    kind: (path) => {
      try {
        const stat = lstatSync(path);
        return stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "dir" : "other";
      } catch {
        return "missing";
      }
    },
  };
};

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The home folder in the account record (`id -P` prints it as a password-file line), not $HOME: under Bun, `os.homedir()` and
 * `os.userInfo()` both follow $HOME, and the folder root hands to the person must be the person's own (#300 review).
 */
function accountHome(uid: number): string | null {
  try {
    const r = Bun.spawnSync(["/usr/bin/id", "-P"], { stdout: "pipe", stderr: "ignore" });
    const home = r.exitCode === 0 ? parseAccountHome(r.stdout.toString(), uid) : null;
    return home === null ? null : realPath(home);
  } catch {
    return null;
  }
}

/** The home field of `id -P`'s `name:passwd:uid:gid:class:change:expire:gecos:home:shell`, when the line is this uid's. */
export function parseAccountHome(line: string, uid: number): string | null {
  const fields = line.trim().split(":");
  // Counted from the end, so a full name with a colon in it can't shift the home field.
  if (fields.length < 10 || fields[2] !== String(uid)) return null;
  const home = fields.at(-2) ?? "";
  return isAbsolute(home) ? home : null;
}

/** The plan for this Colima, or the sentence that says why keyloom can't fix it from here. Checked again inside the root script. */
export function colimaFilesPlan(engine: DockerEngine, deps: PlanDeps): { ok: true; plan: ColimaFilesPlan } | { ok: false; reason: string } {
  if (engine.command[0] !== "colima") return { ok: false, reason: `${engine.name} isn't Colima, so keyloom can't fix its files.` };
  const at = engine.command.indexOf("--profile");
  const profile = at < 0 ? null : engine.command[at + 1] ?? null;
  if (profile !== null && !PROFILE.test(profile)) return { ok: false, reason: `keyloom doesn't recognise the Colima profile "${profile}", so it changed nothing.` };
  if (!Number.isInteger(deps.uid) || deps.uid <= 0) return { ok: false, reason: "keyloom couldn't tell which account to give Colima's files to, so it changed nothing." };
  if (deps.accountHome === null || deps.accountHome === "/") return { ok: false, reason: "keyloom couldn't find your home folder, so it changed nothing." };
  // Colima keeps its files under $HOME. When that isn't the account's home, the folder Colima uses isn't the one root would hand back,
  // and root would be changing a folder keyloom can't vouch for, so nothing runs.
  if (deps.home !== deps.accountHome) {
    return { ok: false, reason: `keyloom is running with its home folder set to ${deps.home}, not your own, ${deps.accountHome}, so it changed nothing. Start keyloom from your own account's settings, then try again.` };
  }
  const colimaHome = join(deps.accountHome, ".colima");
  const kind = deps.kind(colimaHome);
  if (kind !== "dir") {
    return { ok: false, reason: kind === "symlink" ? "~/.colima is a link to another folder, so keyloom won't change its files as an administrator." : "keyloom can't find Colima's folder, ~/.colima, so there are no files to give back." };
  }
  return { ok: true, plan: { colimaHome, uid: deps.uid, profile } };
}

/**
 * `tools` only lets a test stand in for `chown`; the app always uses macOS's own.
 *
 * The root half. It runs only tools from /usr/bin, /bin and /usr/sbin, with a PATH of only those, so nothing the person's account can
 * write runs as root. It gives every file in ~/.colima that isn't the person's back to them; Colima stops and starts as the person after.
 *
 * Handing files to the person as root is where a mistake gives away more than Colima's files, so:
 * - ~/.colima must be a real folder, not a link. The script moves into it and checks it is there before it looks at anything, so a
 *   folder swapped for a link after the check is caught, and `find` walks `.` from inside it.
 * - A Colima VM that root runs from this folder holds its files, so the script stops with `colima_vm_running` and changes nothing.
 *   keyloom won't run Colima as root to stop it; the command to copy does.
 * - A process running as the person can rename and link in any folder the person can write. A file found by name and changed by name
 *   later could by then be a hard link to one of macOS's own files. So no name is changed while the person can change it:
 *   1. Every folder goes to root, top down, with group and other write and any ACL taken off. Each folder's parent is root's by the time
 *      the folder is changed, so the name still means that folder; giving a folder to root gives the person nothing.
 *   2. With no folder the person can write, each file with one name that isn't theirs goes to them. A name can't change between find's
 *      look and chown, and a file with one name, found inside ~/.colima, is not a file elsewhere.
 *   3. Folders go back to the person bottom up, each while its parent is still root's, with any mode step 1 changed put back. Only a
 *      folder step 1 gave to root goes back: a name can point at one only inside a folder that is still root's.
 *   A folder root can't take stops step 1 at that folder, and step 2 never runs, so no file is changed by a name the person can swap.
 * - `find -P` never follows a link; `-xdev` stays on its disk; `chown -h` changes a link itself; `-execdir` runs each change from the
 *   file's own folder, with `./` before the name so a name that starts with `-` is never read as an option.
 * Every value is quoted, the uid is a number, and nothing in the script comes from the page.
 */
export function colimaFilesScript(plan: ColimaFilesPlan, tools: { chown: string } = { chown: "/usr/sbin/chown" }): string {
  if (!Number.isInteger(plan.uid) || plan.uid <= 0) throw new Error("the uid must be a positive integer");
  if (plan.profile !== null && !PROFILE.test(plan.profile)) throw new Error("the Colima profile has characters keyloom doesn't allow");
  const uid = String(plan.uid);
  const chown = shellQuote(tools.chown);
  const find = "/usr/bin/find -P . -xdev";
  // Run per folder in step 3, from the folder's parent: the folder goes back only when step 1 recorded it, then gets its mode back.
  const giveBack = [
    `k=$(/usr/bin/stat -f %d:%i "./$1") || exit 1`,
    `case $KEYLOOM_LOCKED in *" $k "*) ;; *) exit 0;; esac`,
    `case $KEYLOOM_MODES in *" $k:"*) m=\${KEYLOOM_MODES#*" $k:"}; /bin/chmod "\${m%% *}" "./$1" || exit 1;; esac`,
    `exec ${chown} -h ${uid} "./$1"`,
  ].join("; ");
  return [
    "fail() { echo \"keyloom colima fix stopped ($1): $2\" >&2; exit 1; }",
    "PATH=/usr/bin:/bin:/usr/sbin:/sbin; export PATH",
    `dir=${shellQuote(plan.colimaHome)}`,
    `if [ -L "$dir" ] || [ ! -d "$dir" ]; then fail colima_dir_missing "Colima's folder isn't a folder keyloom can change, so nothing changed."; fi`,
    `cd -P "$dir" && [ "$(/bin/pwd -P)" = "$dir" ] || fail colima_dir_missing "Colima's folder changed while keyloom worked, so nothing changed owner."`,
    // Lima keeps each VM's host agent ID in _lima/<instance>/ha.pid. One run by another account, root above all, holds these files.
    `for f in ./_lima/*/ha.pid; do`,
    `  [ -f "$f" ] && [ ! -L "$f" ] || continue`,
    `  pid=$(/usr/bin/head -n 1 "$f"); case $pid in ''|*[!0-9]*) continue;; esac`,
    `  owner=$(/bin/ps -o uid= -p "$pid" | /usr/bin/tr -d ' '); [ -n "$owner" ] && [ "$owner" != ${uid} ] || continue`,
    `  case $(/bin/ps -o comm= -p "$pid") in *limactl) fail colima_vm_running "A copy of Colima started as an administrator is still running, and keyloom won't run Colima as one to stop it, so nothing changed.";; esac`,
    `done`,
    `linked=$(${find} ! -type d -links +1 ! -user ${uid} -print | /usr/bin/head -n 1)`,
    `if [ -n "$linked" ]; then fail colima_linked_file "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: $dir/\${linked#./}"; fi`,
    // Each token is " dev:inode:mode ", so a lookup can't match part of another; nothing but digits and colons comes from stat.
    `KEYLOOM_MODES=" $(${find} -type d -perm +022 -exec /usr/bin/stat -f ' %d:%i:%Lp ' {} +) "`,
    // Step 1. A folder's ID is recorded once it is root's; a folder root can't fully take is pruned, so nothing below it is touched.
    `KEYLOOM_LOCKED=" $(${find} -type d \\( \\( -execdir ${chown} -h 0 ./{} \\; -execdir /usr/bin/stat -f ' %d:%i ' ./{} \\; -execdir /bin/chmod -N ./{} \\; -execdir /bin/chmod go-w ./{} \\; \\) -o \\( -prune -exec /usr/bin/printf ' failed ' \\; \\) \\)) "`,
    `export KEYLOOM_MODES KEYLOOM_LOCKED`,
    `gave=yes`,
    `case $KEYLOOM_LOCKED in *" failed "*) gave=no;; *) ${find} ! -type d -links 1 ! -user ${uid} -execdir ${chown} -h ${uid} {} + || gave=no;; esac`,
    `back=$(${find} -depth -type d ! -execdir /bin/sh -c ${shellQuote(giveBack)} sh {} \\; -exec /usr/bin/printf ' failed ' \\;)`,
    `[ "$gave" = yes ] && [ -z "$back" ] || fail colima_chown_failed "macOS didn't let keyloom give all of Colima's files back to you."`,
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
  if (r.timedOut) return { code: 124, out: "keyloom stopped waiting after ten minutes. Check again in a minute to see whether Colima's files changed." };
  return { code: r.exitCode ?? 1, out: `${r.stdout}\n${r.stderr}` };
};

export type ColimaRootResult = { ok: true } | { ok: false; code: "cancelled" | ColimaFixFailureCode | "failed"; reason: string };

/** Asks for the administrator password and runs the root half. */
export async function runColimaRootSteps(plan: ColimaFilesPlan, run: Runner): Promise<ColimaRootResult> {
  const r = await run(adminCommand(colimaFilesScript(plan), COLIMA_FILES_PROMPT));
  if (r.code === 0) return { ok: true };
  // The script's own stop first: its reason can name a file, and a file name can hold anything, "-128" included (#300 review).
  const failure = colimaFixFailure(r.out);
  if (failure !== null) return { ok: false, ...failure };
  // osascript reports a closed password dialog as error -128, at the end of its "execution error: User canceled. (-128)" line. The
  // number, not the words, because macOS words that line in the person's language.
  if (/\(-128\)\s*$/m.test(r.out)) return { ok: false, code: "cancelled", reason: "You cancelled the password dialog, so Colima's files didn't change." };
  return { ok: false, code: "failed", reason: `macOS couldn't fix Colima's files: ${lastLine(r.out) || `osascript exited ${r.code}`}` };
}
