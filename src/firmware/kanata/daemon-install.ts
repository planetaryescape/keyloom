// The one root script that installs kanata's LaunchDaemon (D-497, D-498). The app runs it through macOS's password dialog; the CLI
// prints it inside `sudo sh -c` for the person to run. Both get the same text, so the two paths can't drift.
import { dirname, join } from "node:path";
import { DAEMON_LABEL, DAEMON_LOG_PATH, DAEMON_PLIST_PATH, ROOT_KANATA_PATH } from "./plist.ts";

/** One shell word: single quotes, with a single quote inside written as '\'' . */
export const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

export type DaemonInstall = {
  /** The plist text, which names ROOT_KANATA_PATH as the program. */
  plist: string;
  /** The kanata binary to copy, and the SHA-256 keyloom read from it before asking for the password. */
  kanata: { source: string; sha256: string };
};

/** Where the script writes. Parameters only so a test can run the script against a temporary folder. */
export type DaemonInstallDest = { plist: string; kanata: string; log: string };
const ROOT_DEST: DaemonInstallDest = { plist: DAEMON_PLIST_PATH, kanata: ROOT_KANATA_PATH, log: DAEMON_LOG_PATH };

/**
 * Why the root script stopped. It prints `keyloom setup stopped (<code>): <reason>` to stderr before it exits 1, so the CLI's `sudo sh -c` shows the
 * reason and the app reads the code from osascript's "execution error" line (`rootScriptFailure`).
 */
export const ROOT_FAILURE_CODES = [
  "kanata_swapped", "root_copy_failed", "root_plist_failed", "root_log_failed", "root_start_failed",
  // The restart and log scripts for an installed service (daemon-service.ts, R11-02).
  "service_missing", "service_outdated", "log_missing",
] as const;
export type RootFailureCode = (typeof ROOT_FAILURE_CODES)[number];

/** The last `keyloom setup stopped (<code>): <reason>` line the root script printed, or null when it printed none (it didn't run, or ran an old copy). */
export function rootScriptFailure(out: string): { code: RootFailureCode; reason: string } | null {
  let found: { code: RootFailureCode; reason: string } | null = null;
  // osascript wraps the script's stderr as "<pos>: execution error: <text> (<status>)".
  for (const m of out.matchAll(/keyloom setup stopped \((\w+)\): (.+?)(?: \(\d+\))?$/gm)) {
    const code = ROOT_FAILURE_CODES.find((c) => c === m[1]);
    if (code !== undefined && m[2] !== undefined) found = { code, reason: m[2].trim() };
  }
  return found;
}

/**
 * Copies kanata to its root-owned place, installs keyloom's LaunchDaemon and (re)loads it, which starts kanata (RunAtLoad). A bootout
 * comes first, so a daemon that is loaded but stopped (the exit chord stops it for good) or one with an older plist starts again.
 *
 * kanata: root copies the binary into a file it creates with `mktemp` in its own folder, and installs it only if the copy's SHA-256 is the
 * one keyloom read and checked for `cmd` before asking. A binary swapped while the password dialog is open is refused, so root runs only
 * the bytes that were checked. The folder is set to root:wheel 755 every time, and the copy to root:wheel 755.
 *
 * The plist: its text travels inside the script, base64-encoded, and root writes it into a file it creates beside the destination.
 * Reading a file from the person's home instead would let any process running as them swap it while the dialog is open, and the swapped
 * `ProgramArguments` would then run as root.
 *
 * Each rename into place is atomic, so launchd never reads a half-written file, and nothing is bootstrapped unless both installs worked
 * and the log is root's alone. Every failure prints `keyloom setup stopped (<code>): <reason>` to stderr before it exits 1.
 * base64's alphabet and a hex digest need no quoting in shell or AppleScript.
 */
export function daemonInstallScript(input: DaemonInstall, dest: DaemonInstallDest = ROOT_DEST): string {
  const sha = input.kanata.sha256;
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("kanata's SHA-256 must be 64 lowercase hex digits");
  const encoded = Buffer.from(input.plist, "utf8").toString("base64");
  const dir = dirname(dest.kanata);
  const binDir = shellQuote(dir);
  const binTo = shellQuote(dest.kanata);
  const binTemplate = shellQuote(join(dir, ".kanata.XXXXXX"));
  const plistTo = shellQuote(dest.plist);
  const plistTemplate = shellQuote(join(dirname(dest.plist), `.${DAEMON_LABEL}.XXXXXX`));
  const log = shellQuote(dest.log);
  // The reasons have no apostrophes, so the command the CLI prints inside `sudo sh -c '…'` stays readable.
  const fail = (code: RootFailureCode, reason: string) => `fail ${code} ${shellQuote(reason)}`;
  return [
    `fail() { printf "keyloom setup stopped (%s): %s\\n" "$1" "$2" >&2; exit 1; };`,
    `mkdir -p ${binDir} && chown root:wheel ${binDir} && chmod 755 ${binDir} || ${fail("root_copy_failed", `keyloom could not make ${dir} a folder only root can change.`)};`,
    `b=$(mktemp ${binTemplate}) || ${fail("root_copy_failed", `keyloom could not create a file in ${dir}.`)};`,
    `cp ${shellQuote(input.kanata.source)} "$b" || { rm -f "$b"; ${fail("root_copy_failed", `keyloom could not copy kanata from ${input.kanata.source}.`)}; };`,
    `[ "$(shasum -a 256 "$b" | cut -d ' ' -f 1)" = ${sha} ] || { rm -f "$b"; ${fail("kanata_swapped", `kanata at ${input.kanata.source} changed after keyloom checked it, so nothing was installed. Set kanata up again.`)}; };`,
    `chown root:wheel "$b" && chmod 755 "$b" && mv -f "$b" ${binTo} || { rm -f "$b"; ${fail("root_copy_failed", `keyloom could not put the kanata copy at ${dest.kanata}.`)}; };`,
    `t=$(mktemp ${plistTemplate}) || ${fail("root_plist_failed", `keyloom could not create a file beside ${dest.plist}.`)};`,
    // `--decode` is the spelling both macOS's and GNU's base64 accept.
    `printf %s '${encoded}' | base64 --decode > "$t" && chown root:wheel "$t" && chmod 644 "$t" && mv -f "$t" ${plistTo} || { rm -f "$t"; ${fail("root_plist_failed", `keyloom could not install ${dest.plist}.`)}; };`,
    // Before the daemon starts: launchd appends to an existing log and keeps its mode, so kanata's output is readable by root only.
    `touch ${log} && chown root:wheel ${log} && chmod 600 ${log} || ${fail("root_log_failed", `keyloom could not make ${dest.log} readable by root only, so kanata was not started.`)};`,
    `launchctl bootout system/${DAEMON_LABEL} 2>/dev/null;`,
    `launchctl bootstrap system ${plistTo} || { sleep 1; launchctl bootstrap system ${plistTo}; } || ${fail("root_start_failed", "macOS did not start the kanata background service (launchctl bootstrap failed).")}`,
  ].join(" ");
}

/** The command the CLI prints for the person to run as root: the same script the app runs. keyloom never runs sudo (D-231). */
export const rootInstallCommand = (input: DaemonInstall): string => `sudo sh -c ${shellQuote(daemonInstallScript(input))}`;
