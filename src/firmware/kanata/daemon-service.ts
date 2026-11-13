// The two root scripts for a kanata service that is installed but doesn't answer (R11-02, D-559): restart it, and read the end of its log.
// Like the install script (daemon-install.ts), each is fixed text: nothing from keyloom, the page or the person's files is put into it,
// every tool runs by its absolute path, and the app runs it through `adminCommand`'s empty environment (D-493, D-498, D-533).
import { DAEMON_LABEL, DAEMON_LOG_PATH, DAEMON_PLIST_PATH, ROOT_KANATA_DIR, ROOT_KANATA_PATH } from "./plist.ts";
import { failLine as fail, shellQuote } from "./daemon-install.ts";

/**
 * Where the scripts look, and the account that must own it. Parameters only so a test, which runs as its own account, can point them at
 * a temporary folder, a stand-in `launchctl` and its own uid; the app always uses the defaults.
 */
export type ServiceScriptTools = { plist: string; kanata: string; kanataDir: string; log: string; launchctl: string; root: number };
const ROOT_TOOLS: ServiceScriptTools = {
  plist: DAEMON_PLIST_PATH, kanata: ROOT_KANATA_PATH, kanataDir: ROOT_KANATA_DIR, log: DAEMON_LOG_PATH, launchctl: "/bin/launchctl", root: 0,
};

/** How many of the log's last lines Show kanata's log reads, and the most bytes it keeps of them. */
export const LOG_TAIL_LINES = 40;
const LOG_TAIL_BYTES = 16_384;

// Each failure prints `keyloom setup stopped (<code>): <reason>` before it exits 1, as the install script does, so `rootScriptFailure`
// reads the code.
const FAIL_FN = `fail() { /usr/bin/printf "keyloom setup stopped (%s): %s\\n" "$1" "$2" >&2; exit 1; };`;

/**
 * Restarts kanata's LaunchDaemon: `launchctl kickstart -k`, which stops and starts a loaded service, or a `bootstrap` when launchd no
 * longer has it loaded. Root starts what the plist names, so the script first checks that both files are the ones setup made and only root
 * can change: the plist root's and mode 644, naming keyloom's own copy of kanata; that copy root's and mode 755, in a folder root's and
 * mode 755 (D-498). A daemon set up before that copy existed runs a kanata the person can replace, and is refused: setting up again fixes it.
 */
export function kanataRestartScript(tools: ServiceScriptTools = ROOT_TOOLS): string {
  const plist = shellQuote(tools.plist);
  const kanata = shellQuote(tools.kanata);
  const dir = shellQuote(tools.kanataDir);
  const launchctl = shellQuote(tools.launchctl);
  const is = (path: string, mode: string, file = true) => `[ ${file ? "-f" : "-d"} ${path} ] && [ ! -L ${path} ] && [ "$(/usr/bin/stat -f '%u %Lp' ${path})" = '${tools.root} ${mode}' ]`;
  return [
    FAIL_FN,
    `${is(plist, "644")} || ${fail("service_missing", "kanata has no background service that only macOS can change, so keyloom restarted nothing. Set kanata up again.")};`,
    `${is(dir, "755", false)} && ${is(kanata, "755")} && /usr/bin/grep -qF ${shellQuote(`<string>${tools.kanata}</string>`)} ${plist} || ${fail("service_outdated", "The background service does not run the copy of kanata that only macOS can change, so keyloom restarted nothing. Set kanata up again.")};`,
    `${launchctl} kickstart -k system/${DAEMON_LABEL} 2>/dev/null || ${launchctl} bootstrap system ${plist} || ${fail("root_start_failed", "macOS did not restart the kanata background service (launchctl kickstart failed).")}`,
  ].join(" ");
}

/**
 * Prints the last lines of kanata's log, which setup makes readable by root only (D-498): a reload error prints the start of a file the
 * config includes, so a world-readable log would show any process the start of a root-only file. Reading it here needs the person's
 * password each time, as `sudo tail` does, and the lines go only to the page that asked (D-559).
 */
export function kanataLogScript(tools: ServiceScriptTools = ROOT_TOOLS): string {
  const log = shellQuote(tools.log);
  return [
    FAIL_FN,
    `[ -f ${log} ] && [ ! -L ${log} ] || ${fail("log_missing", "kanata has no log yet. Its background service writes one once it starts.")};`,
    `/usr/bin/tail -n ${LOG_TAIL_LINES} ${log} | /usr/bin/tail -c ${LOG_TAIL_BYTES}`,
  ].join(" ");
}
