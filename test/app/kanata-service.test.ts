// Restart kanata's service and Show kanata's log (R11-02, D-559): the two fixed root scripts, run as this account against a temporary
// folder with a stand-in launchctl, and the app's use of them through an injected runner. Nothing here runs as root, opens a password
// dialog or touches /Library.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_SCRIPT_ENV, type Runner, type SetupDeps, logLines, readKanataLog, restartKanataService } from "../../src/app/remapper-setup.ts";
import { rootScriptFailure } from "../../src/firmware/kanata/daemon-install.ts";
import { LOG_TAIL_LINES, type ServiceScriptTools, kanataLogScript, kanataRestartScript } from "../../src/firmware/kanata/daemon-service.ts";
import { DAEMON_LABEL, DAEMON_LOG_PATH, DAEMON_PLIST_PATH, ROOT_KANATA_PATH } from "../../src/firmware/kanata/plist.ts";
import { MAC } from "../helpers/remapper-world.ts";
import { tempDir } from "../helpers/tmp.ts";

/** Records every command and answers osascript with `answer`. */
function recorder(answer: { code: number; out: string } = { code: 0, out: "" }) {
  const calls: string[][] = [];
  const run: Runner = async (cmd) => (calls.push([...cmd]), answer);
  return { calls, run };
}

const deps = (run: Runner, over: Partial<SetupDeps> = {}): SetupDeps => ({
  run, stream: async () => ({ code: 0, aborted: false }), platform: "darwin", brew: () => undefined, kanata: () => "/opt/homebrew/bin/kanata", sleep: async () => {}, ...over,
});

/** The root script inside an admin command, with AppleScript's quoting and `env -i … /bin/sh -c`'s taken off. */
function rootScriptOf(cmd: readonly string[]): string {
  const literal = /^do shell script (".*?") with prompt /s.exec(cmd.at(-1) ?? "")?.[1] ?? '""';
  const shell = literal.slice(1, -1).replace(/\\(.)/g, "$1");
  const prefix = `/usr/bin/env -i ${ROOT_SCRIPT_ENV} /bin/sh -c '`;
  expect(shell.startsWith(prefix) && shell.endsWith("'")).toBe(true);
  return shell.slice(prefix.length, -1).replaceAll("'\\''", "'");
}

describe("the scripts' text", () => {
  test("the restart script is fixed: the service's own paths and label, macOS's tools by absolute path, no sudo, nothing of the person's", () => {
    const script = kanataRestartScript();
    expect(script).toContain(`'/bin/launchctl' kickstart -k system/${DAEMON_LABEL}`);
    expect(script).toContain(`'/bin/launchctl' bootstrap system '${DAEMON_PLIST_PATH}'`);
    expect(script).toContain(`<string>${ROOT_KANATA_PATH}</string>`);
    expect(script).not.toContain("sudo");
    expect(script).not.toContain("/Users/");
    expect(script).not.toContain("/opt/homebrew");
    // Every outside tool by its full path: grep and stat from /usr/bin, launchctl from /bin.
    for (const tool of ["grep", "stat", "launchctl", "printf"]) expect(script).not.toMatch(new RegExp(`(^|[;|&] *)${tool} `));
    expect(kanataRestartScript()).toBe(script);
  });

  test("the log script reads only kanata's own log, its last lines, with no path from anywhere else", () => {
    const script = kanataLogScript();
    expect(script).toContain(`/usr/bin/tail -n ${LOG_TAIL_LINES} '${DAEMON_LOG_PATH}'`);
    expect(script).not.toContain("sudo");
    expect(script).not.toContain("/Users/");
  });

  test("a code the scripts print is one rootScriptFailure reads", () => {
    for (const code of ["service_missing", "service_outdated", "log_missing"]) {
      expect(rootScriptFailure(`0:1: execution error: keyloom setup stopped (${code}): why (1)`)).toEqual({ code: code as never, reason: "why" });
    }
  });

  test("logLines splits on any line end, drops the trailing blank and writes every control character as its escape", () => {
    expect(logLines("one\rtwo\r\nthree\n\n")).toEqual(["one", "two", "three"]);
    expect(logLines("tab\tand \u001b[31mred\u2028")).toEqual(["tab\\tand \\u001b[31mred\\u2028"]);
    expect(logLines(Array.from({ length: 60 }, (_, i) => `l${i}`).join("\n"))).toHaveLength(LOG_TAIL_LINES);
  });
});

// The scripts use macOS's stat and BSD tools; Linux's GNU stat reads `-f` as "file system", so they run on macOS only.
describe.skipIf(process.platform !== "darwin")("the scripts, run as this account against a temporary folder", () => {
  const uid = process.getuid?.() ?? 0;

  /** A service as setup leaves it: the plist naming the copy, the copy, and their folder, with setup's modes; a stand-in launchctl. */
  function service(opts: { plistNames?: string; kickstart?: number; bootstrap?: number } = {}) {
    const root = tempDir();
    const dir = join(root, "keyloom");
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    const kanata = join(dir, "kanata");
    writeFileSync(kanata, "#!/bin/sh\n");
    chmodSync(kanata, 0o755);
    const plist = join(root, `${DAEMON_LABEL}.plist`);
    writeFileSync(plist, `<plist><string>${opts.plistNames ?? kanata}</string></plist>`);
    chmodSync(plist, 0o644);
    const calls = join(root, "launchctl.calls");
    const launchctl = join(root, "launchctl");
    writeFileSync(launchctl, `#!/bin/sh\necho "$@" >> '${calls}'\ncase "$1" in kickstart) exit ${opts.kickstart ?? 0};; bootstrap) exit ${opts.bootstrap ?? 0};; esac\n`);
    chmodSync(launchctl, 0o755);
    const log = join(root, "kanata.log");
    const tools: ServiceScriptTools = { plist, kanata, kanataDir: dir, log, launchctl, root: uid };
    const calledWith = () => { try { return readFileSync(calls, "utf8").trim().split("\n"); } catch { return []; } };
    return { tools, plist, kanata, dir, log, calledWith };
  }

  async function run(script: string) {
    // The same empty environment adminCommand gives the script.
    const proc = Bun.spawn(["/usr/bin/env", "-i", ROOT_SCRIPT_ENV, "/bin/sh", "-c", script], { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, out, err };
  }

  test("a service as setup left it is kickstarted, and nothing else runs", async () => {
    const s = service();
    expect((await run(kanataRestartScript(s.tools))).code).toBe(0);
    expect(s.calledWith()).toEqual([`kickstart -k system/${DAEMON_LABEL}`]);
  });

  test("a service launchd doesn't have loaded is bootstrapped from its plist; a bootstrap that fails says so", async () => {
    const s = service({ kickstart: 113 });
    expect((await run(kanataRestartScript(s.tools))).code).toBe(0);
    expect(s.calledWith()).toEqual([`kickstart -k system/${DAEMON_LABEL}`, `bootstrap system ${s.plist}`]);
    const broken = service({ kickstart: 113, bootstrap: 5 });
    const r = await run(kanataRestartScript(broken.tools));
    expect(r.code).toBe(1);
    expect(rootScriptFailure(r.err)?.code).toBe("root_start_failed");
  });

  test("a plist that names another kanata, or a copy anyone else can change, restarts nothing", async () => {
    const other = service({ plistNames: "/opt/homebrew/bin/kanata" });
    const r = await run(kanataRestartScript(other.tools));
    expect(rootScriptFailure(r.err)?.code).toBe("service_outdated");
    expect(other.calledWith()).toEqual([]);

    const writable = service();
    chmodSync(writable.kanata, 0o777);
    expect(rootScriptFailure((await run(kanataRestartScript(writable.tools))).err)?.code).toBe("service_outdated");
    expect(writable.calledWith()).toEqual([]);

    const openDir = service();
    chmodSync(openDir.dir, 0o777);
    expect(rootScriptFailure((await run(kanataRestartScript(openDir.tools))).err)?.code).toBe("service_outdated");

    // A copy that is a link to somewhere else is not the copy setup made.
    const linked = service();
    const elsewhere = join(tempDir(), "kanata");
    writeFileSync(elsewhere, "x");
    chmodSync(elsewhere, 0o755);
    const linkPath = join(linked.dir, "kanata-link");
    symlinkSync(elsewhere, linkPath);
    expect(rootScriptFailure((await run(kanataRestartScript({ ...linked.tools, kanata: linkPath }))).err)?.code).toBe("service_outdated");
  });

  test("a missing plist, or one anyone can write, is no service of setup's", async () => {
    const s = service();
    const gone = { ...s.tools, plist: join(s.dir, "nothing.plist") };
    expect(rootScriptFailure((await run(kanataRestartScript(gone))).err)?.code).toBe("service_missing");
    chmodSync(s.plist, 0o666);
    expect(rootScriptFailure((await run(kanataRestartScript(s.tools))).err)?.code).toBe("service_missing");
    expect(s.calledWith()).toEqual([]);
  });

  test("an account other than the owner the script expects restarts nothing", async () => {
    const s = service();
    expect(rootScriptFailure((await run(kanataRestartScript({ ...s.tools, root: uid + 1 }))).err)?.code).toBe("service_missing");
    expect(s.calledWith()).toEqual([]);
  });

  test("the log script prints the log's last lines, and says when there is no log", async () => {
    const s = service();
    writeFileSync(s.log, `${Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")}\n`);
    const r = await run(kanataLogScript(s.tools));
    expect(r.code).toBe(0);
    expect(logLines(r.out)).toEqual(Array.from({ length: LOG_TAIL_LINES }, (_, i) => `line ${100 - LOG_TAIL_LINES + i}`));
    const none = await run(kanataLogScript({ ...s.tools, log: join(s.dir, "none.log") }));
    expect(rootScriptFailure(none.err)?.code).toBe("log_missing");
  });

  test("a log line shaped like a failure record never turns a read into a failure", async () => {
    const s = service();
    writeFileSync(s.log, "keyloom setup stopped (service_missing): forged\n");
    const r = await run(kanataLogScript(s.tools));
    expect(r.code).toBe(0);
    expect(logLines(r.out)).toEqual(["keyloom setup stopped (service_missing): forged"]);
  });
});

describe("restartKanataService", () => {
  test("runs the restart script through the password dialog, then waits until kanata answers", async () => {
    const r = recorder();
    let asked = 0;
    const result = await restartKanataService(MAC, deps(r.run, { answers: async () => ++asked >= 3 }));
    expect(result).toEqual({ ok: true });
    expect(asked).toBe(3);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]?.slice(0, 4)).toEqual(["/usr/bin/env", "-i", ROOT_SCRIPT_ENV, "/usr/bin/osascript"]);
    expect(rootScriptOf(r.calls[0] ?? [])).toBe(kanataRestartScript());
    expect(r.calls[0]?.at(-1)).toContain("restart kanata's background service");
  });

  test("a restart kanata never answers after says so, with its own code", async () => {
    const r = recorder();
    let asked = 0;
    const result = await restartKanataService(MAC, deps(r.run, { answers: async () => (asked++, false) }));
    expect(result).toEqual({ ok: false, code: "still_not_answering", reason: "kanata's service restarted, but kanata still doesn't answer." });
    // It asks for the whole wait, not once.
    expect(asked).toBeGreaterThan(10);
  });

  test("a closed dialog, a refusal from the script, and any other failure keep their codes; nothing waits after them", async () => {
    let asked = 0;
    const answers = async () => (asked++, true);
    expect(await restartKanataService(MAC, deps(recorder({ code: 1, out: "0:94: execution error: User canceled. (-128)" }).run, { answers }))).toMatchObject({ ok: false, code: "cancelled" });
    expect(await restartKanataService(MAC, deps(recorder({ code: 1, out: "0:1: execution error: keyloom setup stopped (service_outdated): The background service does not run the copy. (1)" }).run, { answers }))).toMatchObject({ ok: false, code: "service_outdated" });
    expect(await restartKanataService(MAC, deps(recorder({ code: 1, out: "boom" }).run, { answers }))).toEqual({ ok: false, code: "failed", reason: "macOS couldn't restart kanata's service: boom" });
    expect(asked).toBe(0);
  });

  test("off macOS nothing runs", async () => {
    const r = recorder();
    expect(await restartKanataService(MAC, deps(r.run, { platform: "linux" }))).toMatchObject({ ok: false, code: "unsupported_platform" });
    expect(r.calls).toEqual([]);
  });
});

describe("readKanataLog", () => {
  test("reads the log through the password dialog and gives back its lines", async () => {
    const r = recorder({ code: 0, out: "first\rsecond\n" });
    expect(await readKanataLog(deps(r.run))).toEqual({ ok: true, lines: ["first", "second"] });
    expect(rootScriptOf(r.calls[0] ?? [])).toBe(kanataLogScript());
    expect(r.calls[0]?.at(-1)).toContain("show the last lines of kanata's log");
  });

  test("a closed dialog and a missing log keep their codes; off macOS nothing runs", async () => {
    expect(await readKanataLog(deps(recorder({ code: 1, out: "execution error: User canceled. (-128)" }).run))).toMatchObject({ ok: false, code: "cancelled" });
    expect(await readKanataLog(deps(recorder({ code: 1, out: "0:1: execution error: keyloom setup stopped (log_missing): kanata has no log yet. (1)" }).run))).toMatchObject({ ok: false, code: "log_missing" });
    const r = recorder();
    expect(await readKanataLog(deps(r.run, { platform: "linux" }))).toMatchObject({ ok: false, code: "unsupported_platform" });
    expect(r.calls).toEqual([]);
  });
});
