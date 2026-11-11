// The one root script that installs kanata's LaunchDaemon (D-497, D-498). The app runs it through macOS's password dialog; the CLI
// prints it inside `sudo sh -c` for the person to run. Both get the same text, so the two paths can't drift.
import { dirname, join } from "node:path";
import { DAEMON_LABEL, DAEMON_PLIST_PATH, ROOT_KANATA_PATH } from "./plist.ts";

/** One shell word: single quotes, with a single quote inside written as '\'' . */
export const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

export type DaemonInstall = {
  /** The plist text, which names ROOT_KANATA_PATH as the program. */
  plist: string;
  /** The kanata binary to copy, and the SHA-256 keyloom read from it before asking for the password. */
  kanata: { source: string; sha256: string };
};

/** Where the script writes. Parameters only so a test can run the script against a temporary folder. */
export type DaemonInstallDest = { plist: string; kanata: string };
const ROOT_DEST: DaemonInstallDest = { plist: DAEMON_PLIST_PATH, kanata: ROOT_KANATA_PATH };

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
 * Each rename into place is atomic, so launchd never reads a half-written file, and nothing is bootstrapped unless both installs worked.
 * base64's alphabet and a hex digest need no quoting in shell or AppleScript.
 */
export function daemonInstallScript(input: DaemonInstall, dest: DaemonInstallDest = ROOT_DEST): string {
  const sha = input.kanata.sha256;
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("kanata's SHA-256 must be 64 lowercase hex digits");
  const encoded = Buffer.from(input.plist, "utf8").toString("base64");
  const binDir = shellQuote(dirname(dest.kanata));
  const binTo = shellQuote(dest.kanata);
  const binTemplate = shellQuote(join(dirname(dest.kanata), ".kanata.XXXXXX"));
  const plistTo = shellQuote(dest.plist);
  const plistTemplate = shellQuote(join(dirname(dest.plist), `.${DAEMON_LABEL}.XXXXXX`));
  return [
    `mkdir -p ${binDir} && chown root:wheel ${binDir} && chmod 755 ${binDir} || exit 1;`,
    `b=$(mktemp ${binTemplate}) || exit 1;`,
    `if cp ${shellQuote(input.kanata.source)} "$b" && [ "$(shasum -a 256 "$b" | cut -d ' ' -f 1)" = ${sha} ] && chown root:wheel "$b" && chmod 755 "$b" && mv -f "$b" ${binTo}; then :;`,
    `else rm -f "$b"; exit 1; fi;`,
    `t=$(mktemp ${plistTemplate}) || exit 1;`,
    // `--decode` is the spelling both macOS's and GNU's base64 accept.
    `if printf %s '${encoded}' | base64 --decode > "$t" && chown root:wheel "$t" && chmod 644 "$t" && mv -f "$t" ${plistTo}; then`,
    `launchctl bootout system/${DAEMON_LABEL} 2>/dev/null; launchctl bootstrap system ${plistTo} || { sleep 1; launchctl bootstrap system ${plistTo}; };`,
    `else rm -f "$t"; exit 1; fi`,
  ].join(" ");
}

/** The command the CLI prints for the person to run as root: the same script the app runs. keyloom never runs sudo (D-231). */
export const rootInstallCommand = (input: DaemonInstall): string => `sudo sh -c ${shellQuote(daemonInstallScript(input))}`;
