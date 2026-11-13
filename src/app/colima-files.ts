// Fix Colima's files (D-533): a Colima started with `sudo` leaves ~/.colima, and the socket in it, to root, so Docker refuses this account.
// The fix gives the files back to the person as root through macOS's password dialog (D-493), and then keyloom stops and starts Colima as
// the person. Only the ownership change runs as root, and it runs only macOS's own tools: nothing the person's account can replace runs as
// root. Every outside command goes through an injected runner, so no test stops Colima or asks for a password.
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
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

/**
 * Why the root script stopped. It prints `keyloom colima fix stopped (<code>): <detail>` before it exits 1, and that record is all it
 * prints: every other tool's errors go nowhere, because they can quote a file name, and a file name can hold a line break and a forged
 * record (PR #300 CodeRabbit). The detail is the script's own fixed words, or, for `colima_linked_file`, the file's name as hex.
 */
export const COLIMA_FIX_FAILURE_CODES = ["colima_dir_missing", "colima_vm_running", "colima_linked_file", "colima_chown_failed"] as const;
export type ColimaFixFailureCode = (typeof COLIMA_FIX_FAILURE_CODES)[number];

/** Said when another account's Colima VM runs from ~/.colima: by the check before the dialog, and by the root script's own. */
export const COLIMA_VM_RUNNING = "A copy of Colima started as an administrator is still running, and keyloom won't run Colima as one to stop it, so nothing changed.";

/** Each stop's words, kept here, so the page's sentence never comes from text the script printed. */
const COLIMA_FIX_REASONS: Record<ColimaFixFailureCode, string> = {
  colima_dir_missing: "Colima's folder isn't a folder keyloom can change, or it changed while keyloom worked, so nothing changed.",
  colima_vm_running: COLIMA_VM_RUNNING,
  colima_linked_file: "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back",
  colima_chown_failed: "macOS didn't let keyloom give all of Colima's files back to you.",
};

/**
 * The failure record the root script printed, or null when it printed none. osascript wraps stderr in its "execution error" line. The
 * reason is keyloom's own sentence for the code; for a linked file, `file` is its full path, decoded from hex and shown with any control
 * character escaped. `colimaHome` is the folder the script ran in, which the file's name is relative to.
 */
export function colimaFixFailure(out: string, colimaHome = "~/.colima"): { code: ColimaFixFailureCode; reason: string; file?: string } | null {
  let found: { code: ColimaFixFailureCode; reason: string; file?: string } | null = null;
  for (const m of out.matchAll(/keyloom colima fix stopped \((\w+)\): ([^\r\n]*)/g)) {
    const code = COLIMA_FIX_FAILURE_CODES.find((c) => c === m[1]);
    if (code === undefined) continue;
    if (code !== "colima_linked_file") {
      found = { code, reason: COLIMA_FIX_REASONS[code] };
      continue;
    }
    const hex = /^([0-9a-f]{2})+/.exec(m[2] ?? "")?.[0];
    const file = printable(`${colimaHome}/${hex === undefined ? "" : Buffer.from(hex, "hex").toString("utf8")}`);
    found = { code, reason: `${COLIMA_FIX_REASONS[code]}: ${file}`, file };
  }
  return found;
}

/** A path as text that can't start a new line or move the cursor: each control character is written as its escape. */
export function printable(path: string): string {
  return path.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => {
    const code = c.charCodeAt(0);
    return code === 0x0a ? "\\n" : code === 0x0d ? "\\r" : code === 0x09 ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
  });
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
  /** The first line of each `_lima/<instance>/ha.pid` under ~/.colima that is a plain file this account can read. */
  hostAgentPids: (colimaHome: string) => string[];
  /** The owner and command of a running process, or null when there is none or `ps` can't say. */
  processOf: (pid: number) => { uid: number; comm: string } | null;
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
    hostAgentPids: (colimaHome) => {
      const lima = join(colimaHome, "_lima");
      let instances: string[];
      try {
        instances = readdirSync(lima);
      } catch {
        return [];
      }
      return instances.flatMap((instance) => {
        const file = join(lima, instance, "ha.pid");
        try {
          return lstatSync(file).isFile() ? [readFileSync(file, "utf8").split("\n")[0] ?? ""] : [];
        } catch {
          return [];
        }
      });
    },
    processOf: (pid) => {
      try {
        const r = Bun.spawnSync(["/bin/ps", "-o", "uid=,comm=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
        return r.exitCode === 0 ? parsePsLine(r.stdout.toString()) : null;
      } catch {
        return null;
      }
    },
  };
};

/** `ps -o uid=,comm=`'s line: the uid, then the command, which may hold spaces. */
export function parsePsLine(line: string): { uid: number; comm: string } | null {
  const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
  return m === null ? null : { uid: Number(m[1]), comm: m[2] ?? "" };
}

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
export function colimaFilesPlan(engine: DockerEngine, deps: PlanDeps): { ok: true; plan: ColimaFilesPlan } | { ok: false; reason: string; code?: "colima_vm_running" } {
  const target = colimaFilesTarget(engine, deps);
  if (!target.ok) return target;
  // The root script's own check, made here without root, so a password isn't asked for a fix that would stop at it (PR #300
  // CodeRabbit). The script still checks, because what runs can change while the dialog is open. A pid file keyloom can't read, or
  // one without a number, is passed over here as there.
  for (const pid of deps.hostAgentPids(target.plan.colimaHome)) {
    if (!/^\d+$/.test(pid)) continue;
    const proc = deps.processOf(Number(pid));
    if (proc !== null && proc.uid !== deps.uid && proc.comm.endsWith("limactl")) return { ok: false, reason: COLIMA_VM_RUNNING, code: "colima_vm_running" };
  }
  return target;
}

/**
 * The folder and account the fix is for, checked: the plan without its check for a running VM. The look for a linked file uses this
 * alone, because a VM that blocks the fix doesn't stop the command to copy from changing a linked file (PR #300 CodeRabbit).
 */
function colimaFilesTarget(engine: DockerEngine, deps: PlanDeps): { ok: true; plan: ColimaFilesPlan } | { ok: false; reason: string } {
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
 * `tools` only lets a test, which runs as its own account, stand in for `chown` and for root's uid; the app always uses macOS's own
 * chown and uid 0.
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
 *   later could by then be a hard link to one of macOS's own files. So root changes a name only from inside a folder the person can't
 *   change: every step that changes something runs from `.`, the folder find is in, and checks it first, in the same shell: root's, with
 *   no group or other write and no ACL, and (in steps 2 and 3) one step 1 recorded.
 *   1. Every folder goes to root, top down, with group and other write and any ACL taken off, each from a parent already root's. Each
 *      change is made from inside the folder, on `.`, and the folder recorded is the one changed: a disk image the person mounts on a
 *      folder they own changes what its name means without a write to the parent, so a change made by name could land on the image while
 *      the real folder stays theirs (#300 re-review). A parent that isn't root's stops the step at that folder.
 *   2. Each file with one name that isn't the person's goes to them, from its own folder, once that folder passes the check. A folder that
 *      fails stops the step there, so nothing more changes. A file with one name, found inside ~/.colima, is not a file elsewhere.
 *   3. Folders go back to the person bottom up, each from a parent that passes the check, so its parent is still root's, with any mode
 *      step 1 changed put back, setuid, setgid and sticky bits included. Only a folder step 1 recorded goes back. Step 3 walks every
 *      folder, the ones step 1 never took included, and the person can move a folder already given back into one of those; from there it
 *      is passed over (#300 third review).
 *   A folder root can't take stops step 1 at that folder, and step 2 never runs, so no file is changed by a name the person can swap.
 *   Root still reads by name in folders the person can write: find's looks, the `stat` of each folder's mode before step 1, and each
 *   `ha.pid`, whose text reaches only `ps`, as digits.
 * - `find -P` never follows a link; `-xdev` stays on its disk; `chown -h` changes a link itself; `-execdir` runs each change from the
 *   file's own folder, with `./` before the name so a name that starts with `-` is never read as an option.
 * Every value is quoted, the uid is a number, and nothing in the script comes from the page.
 */
export function colimaFilesScript(plan: ColimaFilesPlan, tools: { chown: string; root?: number } = { chown: "/usr/sbin/chown" }): string {
  if (!Number.isInteger(plan.uid) || plan.uid <= 0) throw new Error("the uid must be a positive integer");
  if (plan.profile !== null && !PROFILE.test(plan.profile)) throw new Error("the Colima profile has characters keyloom doesn't allow");
  const uid = String(plan.uid);
  const chown = shellQuote(tools.chown);
  const root = String(tools.root ?? 0);
  if (!/^\d+$/.test(root)) throw new Error("root's uid must be a number");
  const find = "/usr/bin/find -P . -xdev";
  // Each find's last word: no step, and nothing a step starts, holds the record channel (fd 3) open after the script ends.
  const closed = "3>&-";
  // `.`, the folder a step runs from, is one the person can't rename or link in: root's, with no group or other write and no ACL
  // (`ls -lde` prints one line more for each ACL entry; the pattern matches `stat`'s symbolic mode). `.` is the folder find is in, which no
  // name change can move, and the check is in the same shell as the change, so nothing can change `.` between. `$s` keeps its ID.
  const held = (otherwise: string) => [
    `s=$(/usr/bin/stat -f '%u %d:%i %Sp' .) || exit 1`,
    `case $s in "${root} "*" "d????-??-?) ;; *) ${otherwise};; esac`,
    `a=$(/bin/ls -lde .) || exit 1; case $a in *"\n"*) ${otherwise};; esac`,
  ];
  // ...and one step 1 recorded, so not a folder that only looks like one (#300 re-review).
  const recorded = (otherwise: string) => `k=\${s#* }; k=\${k%% *}; case $KEYLOOM_LOCKED in *" $k "*) ;; *) ${otherwise};; esac`;
  // Step 1, run per folder from its parent, which must be root's already. The walk reaches a folder only through its parent, but a disk
  // image mounted on that parent for just its change, and gone before the walk goes in, leaves the real parent the person's (#300 third
  // review). The starting folder `.` has no parent in the walk. `cd -P` first, so every change lands on the one folder `.` is, whatever
  // its name means later, and the ID recorded is that folder's. The ID is printed right after the owner change, so step 3 gives back a
  // folder whose later change failed.
  const lock = [
    `if [ "$1" != . ]; then ${held("exit 1").join("; ")}; fi`,
    `cd -P "./$1" || exit 1`,
    `${chown} -h 0 . && /usr/bin/stat -f ' %d:%i ' . && /bin/chmod -N . && exec /bin/chmod go-w .`,
  ].join("; ");
  // Step 2, run per file from its folder: `.` is checked, then the file changes owner.
  const give = [...held("exit 1"), recorded("exit 1"), `exec ${chown} -h ${uid} "./$1"`].join("; ");
  // Step 3, run per folder from its parent: only from a parent that is still root's and recorded, since a folder the person can write can
  // hold any name by the time root acts on it, a recorded folder moved there included (#300 third review). A folder there is already the
  // person's or never was root's, so it is passed over. The folder goes back only when step 1 recorded it, then gets its mode back.
  const giveBack = [
    ...held("exit 0"),
    recorded("exit 0"),
    `k=$(/usr/bin/stat -f %d:%i "./$1") || exit 1`,
    `case $KEYLOOM_LOCKED in *" $k "*) ;; *) exit 0;; esac`,
    `case $KEYLOOM_MODES in *" $k:"*) m=\${KEYLOOM_MODES#*" $k:"}; /bin/chmod "\${m%% *}" "./$1" || exit 1;; esac`,
    `exec ${chown} -h ${uid} "./$1"`,
  ].join("; ");
  return [
    // The failure record is all the script prints: other tools' errors can quote a file name, which can hold a forged record.
    "exec 3>&2 2>/dev/null",
    "fail() { printf 'keyloom colima fix stopped (%s): %s\\n' \"$1\" \"$2\" >&3; exit 1; }",
    "PATH=/usr/bin:/bin:/usr/sbin:/sbin; export PATH",
    `dir=${shellQuote(plan.colimaHome)}`,
    `if [ -L "$dir" ] || [ ! -d "$dir" ]; then fail colima_dir_missing "Colima's folder isn't a folder keyloom can change, so nothing changed."; fi`,
    `cd -P "$dir" && [ "$(/bin/pwd -P)" = "$dir" ] || fail colima_dir_missing "Colima's folder changed while keyloom worked, so nothing changed owner."`,
    // Lima keeps each VM's host agent ID in _lima/<instance>/ha.pid. One run by another account, root above all, holds these files.
    `for f in ./_lima/*/ha.pid; do`,
    `  [ -f "$f" ] && [ ! -L "$f" ] || continue`,
    `  pid=$(/usr/bin/head -n 1 "$f"); case $pid in ''|*[!0-9]*) continue;; esac`,
    `  owner=$(/bin/ps -o uid= -p "$pid" | /usr/bin/tr -d ' '); [ -n "$owner" ] && [ "$owner" != ${uid} ] || continue`,
    `  case $(/bin/ps -o comm= -p "$pid") in *limactl) fail colima_vm_running "${COLIMA_VM_RUNNING}";; esac`,
    `done`,
    // The name goes out as hex, so no name, line breaks and all, can read as a record of its own.
    `linked=$(${find} ! -type d -links +1 ! -user ${uid} -print -quit ${closed})`,
    `if [ -n "$linked" ]; then fail colima_linked_file "$(/usr/bin/printf %s "\${linked#./}" | /usr/bin/od -An -v -tx1 | /usr/bin/tr -d ' \\n')"; fi`,
    // Each token is " dev:inode:mode ", so a lookup can't match part of another; nothing but digits and colons comes from stat.
    // %Mp%Lp is the whole mode, setuid, setgid and sticky bits included, which a bare `chmod 777` would clear.
    `KEYLOOM_MODES=" $(${find} -type d -perm +022 -exec /usr/bin/stat -f ' %d:%i:%Mp%Lp ' {} + ${closed}) "`,
    // Step 1. A folder's ID is recorded once it is root's; a folder root can't fully take is pruned, so nothing below it is touched.
    `KEYLOOM_LOCKED=" $(${find} -type d \\( -execdir /bin/sh -c ${shellQuote(lock)} sh {} \\; -o \\( -prune -exec /usr/bin/printf ' failed ' \\; \\) \\) ${closed}) "`,
    `export KEYLOOM_MODES KEYLOOM_LOCKED`,
    `gave=yes`,
    // Step 2. The first file whose folder fails the check, or whose change fails, ends it: -quit stops find, so nothing more changes.
    `case $KEYLOOM_LOCKED in *" failed "*) gave=no;; *) case $(${find} ! -type d -links 1 ! -user ${uid} \\( -execdir /bin/sh -c ${shellQuote(give)} sh {} \\; -o -exec /usr/bin/printf ' failed ' \\; -quit \\) ${closed}) in *failed*) gave=no;; esac;; esac`,
    `back=$(${find} -depth -type d ! -execdir /bin/sh -c ${shellQuote(giveBack)} sh {} \\; -exec /usr/bin/printf ' failed ' \\; ${closed})`,
    `[ "$gave" = yes ] && [ -z "$back" ] || fail colima_chown_failed "macOS didn't let keyloom give all of Colima's files back to you."`,
  ].join("\n");
}

/**
 * What the person's own look in ~/.colima found: a file that isn't the person's and has a second name, a look that read every folder and
 * found none, or a look that didn't finish. Colima's command to copy runs `chown -R`, which would change that file wherever its other name
 * is, so the page shows the command only after `none` (D-533).
 */
export type ColimaLinkedScan = { kind: "found"; file: string } | { kind: "none" } | { kind: "incomplete" };

/**
 * Looks for a linked file as the person, without root (PR #300 CodeRabbit). It checks the same folder and account as the fix, but not for
 * a running VM: that blocks the fix, not the command to copy. A folder the person can't read makes `find` print an error and exit non-zero,
 * and then the look is `incomplete`, not `none`. Under `bun test` it reads nothing and says so; `deps` lets a test point it at a
 * temporary folder.
 */
export async function colimaLinkedFileSeen(engine: DockerEngine, deps: () => PlanDeps = realPlanDeps): Promise<ColimaLinkedScan> {
  if (process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS === "1") return { kind: "incomplete" };
  const target = colimaFilesTarget(engine, deps());
  if (!target.ok) return { kind: "incomplete" };
  const { colimaHome, uid } = target.plan;
  try {
    const r = await capture(["/usr/bin/find", "-P", colimaHome, "-xdev", "!", "-type", "d", "-links", "+1", "!", "-user", String(uid), "-print", "-quit"], { timeoutMs: 10_000 });
    if (r.stdout !== "") return { kind: "found", file: printable(r.stdout) };
    return r.exitCode === 0 && !r.timedOut && r.stderr.trim() === "" ? { kind: "none" } : { kind: "incomplete" };
  } catch {
    return { kind: "incomplete" };
  }
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

/** `file` names the linked file, for `colima_linked_file`. */
export type ColimaRootResult = { ok: true } | { ok: false; code: "cancelled" | ColimaFixFailureCode | "failed"; reason: string; file?: string };

/** Asks for the administrator password and runs the root half. */
export async function runColimaRootSteps(plan: ColimaFilesPlan, run: Runner): Promise<ColimaRootResult> {
  const r = await run(adminCommand(colimaFilesScript(plan), COLIMA_FILES_PROMPT));
  if (r.code === 0) return { ok: true };
  // The script's own stop first: its reason can name a file, and a file name can hold anything, "-128" included (#300 review).
  const failure = colimaFixFailure(r.out, plan.colimaHome);
  if (failure !== null) return { ok: false, ...failure };
  // osascript reports a closed password dialog as error -128, at the end of its "execution error: User canceled. (-128)" line. The
  // number, not the words, because macOS words that line in the person's language.
  if (/\(-128\)\s*$/m.test(r.out)) return { ok: false, code: "cancelled", reason: "You cancelled the password dialog, so Colima's files didn't change." };
  return { ok: false, code: "failed", reason: `macOS couldn't fix Colima's files: ${lastLine(r.out) || `osascript exited ${r.code}`}` };
}
