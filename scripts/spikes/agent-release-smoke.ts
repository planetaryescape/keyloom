#!/usr/bin/env bun
// Installed-binary verification only. No app seams, real credentials or device writes.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ConversationDetailSchema } from "../../src/api/http.ts";
import { fakeCodex, type FakeStep } from "../../test/helpers/fake-codex.ts";

const ROOT = resolve(import.meta.dir, "../..");
const NOTE = "I will inspect the synthetic base layer without changing it.";
const ANSWER = "The synthetic Moonlander inspection is complete. No layout or device was changed.";
const PROMPT = "Inspect the synthetic base layer only; do not propose or apply changes.";
const BOARD = "zsa/moonlander";
const MARKER = "keyloom-26a-installed-smoke-v1";
const StateSchema = z.object({
  marker: z.literal(MARKER), binary: z.string(), binarySha256: z.string().regex(/^[a-f0-9]{64}$/),
  layoutId: z.string().optional(), conversationId: z.string().optional(),
}).strict();
type State = z.infer<typeof StateSchema>;
type Check = { name: string; pass: boolean };
type CommandResult = { args: string[]; exitCode: number | null; timedOut: boolean; unknownCommand: boolean };
const checks: Check[] = [];
const commands: CommandResult[] = [];
const owned = new Set<ChildProcess>();
let interrupted = false;

function requireSafe(ok: boolean, label: string): asserts ok {
  if (!ok) throw new Error(label);
}
function check(name: string, pass: boolean): void { checks.push({ name, pass }); }
function inside(parent: string, child: string): boolean {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
}
function noLinks(path: string): void {
  for (let part = path; ; part = dirname(part)) {
    requireSafe(!lstatSync(part).isSymbolicLink(), "Refusing a symlink in the scratch path");
    if (dirname(part) === part) break;
  }
}
function killOwned(child: ChildProcess, signal: NodeJS.Signals): void {
  // Each child owns a new process group; this includes its fake Codex descendants, never other servers.
  if (!owned.has(child) || child.pid === undefined) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}
function stop(): void {
  interrupted = true;
  for (const child of owned) killOwned(child, "SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const completed: FakeStep[] = [
  { say: NOTE }, { call: "get_layout", input: { layers: ["layer-0"] } }, { say: ANSWER },
];
const stopping: FakeStep[] = [
  { say: "I will prepare a synthetic copy, not put it on the keyboard." },
  { call: "create_config", input: { name: "26a synthetic prepared copy", from: "this" } },
  { say: "The synthetic copy is prepared. Stop now to inspect the non-rollback warning." },
  { hang: true },
];

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    binary: { type: "string" }, scratch: { type: "string" }, serve: { type: "boolean" },
    "prepare-only": { type: "boolean" }, "browser-scenario": { type: "string" }, help: { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log("bun scripts/spikes/agent-release-smoke.ts --binary ABS --scratch ABS [--prepare-only | --serve [--browser-scenario completed|stop]]");
    return;
  }
  const binaryArg = values.binary;
  const scratchArg = values.scratch;
  requireSafe(binaryArg !== undefined && isAbsolute(binaryArg), "--binary must be an absolute executable path");
  requireSafe(scratchArg !== undefined && isAbsolute(scratchArg), "--scratch must be an absolute fresh directory path");
  requireSafe(!(values.serve && values["prepare-only"]), "Choose --prepare-only or --serve, not both");
  const scenario = values["browser-scenario"];
  requireSafe(scenario === undefined || (values.serve === true && ["completed", "stop"].includes(scenario)), "--browser-scenario completed|stop requires --serve");
  const binary = realpathSync(binaryArg);
  requireSafe(lstatSync(binary).isFile() && (lstatSync(binary).mode & 0o111) !== 0, "--binary is not an executable file");
  const scratch = resolve(scratchArg);
  requireSafe(!inside(ROOT, scratch) && !inside(scratch, ROOT) && scratch.split(sep).length > 3, "Refusing a repository or shallow scratch path");
  requireSafe(!scratch.split(sep).some((part) => part.startsWith(".")), "Refusing scratch under hidden configuration or credential directories");
  noLinks(dirname(scratch));
  const paths = {
    state: join(scratch, "session.json"), report: join(scratch, values.serve ? "server-results.json" : "results.json"), data: join(scratch, "data"),
    home: join(scratch, "home"), codex: join(scratch, "codex-home"), tmp: join(scratch, "tmp"),
    fake: join(scratch, "fake-codex", "codex"), scenario: join(scratch, "fake-codex", "scenario.json"),
    record: join(scratch, "fake-codex", "record.json"),
  };
  const sha = createHash("sha256").update(readFileSync(binary)).digest("hex");
  let state: State;
  if (existsSync(scratch)) {
    requireSafe(values.serve === true, "Scratch already exists; use a fresh directory (only --serve reuses an owned session)");
    noLinks(scratch);
    requireSafe(lstatSync(paths.state).isFile() && !lstatSync(paths.state).isSymbolicLink(), "Missing safe session marker");
    state = StateSchema.parse(JSON.parse(readFileSync(paths.state, "utf8")));
    requireSafe(state.binary === binary && state.binarySha256 === sha, "Binary changed; prepare a new scratch session");
    requireSafe(state.layoutId !== undefined && state.conversationId !== undefined, "Session did not complete CLI preparation");
  } else {
    mkdirSync(scratch, { mode: 0o700 });
    for (const path of [paths.data, paths.home, paths.codex, paths.tmp, join(scratch, "xdg-config"), join(scratch, "xdg-cache")]) mkdirSync(path, { mode: 0o700 });
    state = { marker: MARKER, binary, binarySha256: sha };
    // Reuse the existing helper unchanged, then move its two synthetic files into this session.
    const oldTmp = process.env.TMPDIR;
    try {
      process.env.TMPDIR = paths.tmp;
      const fake = fakeCodex({ steps: completed });
      requireSafe(inside(paths.tmp, fake.dir), "Fake helper did not use the isolated temporary directory");
      renameSync(fake.dir, dirname(paths.fake));
    } finally {
      if (oldTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = oldTmp;
    }
    chmodSync(dirname(paths.fake), 0o700);
    // The shared helper normally records the MCP token and environment. Sink it before ANY execution.
    symlinkSync("/dev/null", paths.record);
    writeFileSync(paths.state, JSON.stringify(state, null, 2), { mode: 0o600 });
  }

  // Allowlist, not a filtered copy of process.env: no provider keys, proxies, traces or auth settings.
  const env: NodeJS.ProcessEnv = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: "en_US.UTF-8",
    HOME: paths.home, CODEX_HOME: paths.codex, TMPDIR: paths.tmp,
    XDG_DATA_HOME: join(scratch, "xdg-data"), XDG_CONFIG_HOME: join(scratch, "xdg-config"), XDG_CACHE_HOME: join(scratch, "xdg-cache"),
    KEYLOOM_CODEX_BIN: paths.fake, KEYLOOM_PROVIDER: "codex",
  };
  const isolation = () => {
    // Reused sessions may contain user-edited scenarios, but never links into real data or credentials.
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) requireSafe(path === paths.record && readlinkSync(path) === "/dev/null", "Unexpected scratch symlink");
        else if (stat.isDirectory()) walk(path);
        else requireSafe(stat.isFile(), "Unexpected non-file in scratch");
      }
    };
    walk(scratch);
    requireSafe(lstatSync(paths.record).isSymbolicLink() && readlinkSync(paths.record) === "/dev/null", "Fake record must remain a null sink");
    requireSafe(readdirSync(paths.codex).length === 0, "CODEX_HOME must stay empty; no auth or configuration files allowed");
  };
  const save = () => {
    // An isolation refusal must not be followed by writing a report through an unexpected link.
    isolation();
    writeFileSync(paths.state, JSON.stringify(state, null, 2), { mode: 0o600 });
    writeFileSync(paths.report, JSON.stringify({
      binary, binarySha256: sha, scratch, layoutId: state.layoutId, conversationId: state.conversationId,
      checks, commands, passed: checks.length > 0 && checks.every((c) => c.pass),
      browser: "unverified: inspect the actual served app manually; CLI checks do not certify browser behavior or a release",
    }, null, 2), { mode: 0o600 });
  };
  const run = async (args: string[], serving = false): Promise<string> => {
    isolation();
    requireSafe(!interrupted, "Interrupted; no further child commands started");
    const full = ["--data-dir", paths.data, "--format", "json", ...args];
    const child = spawn(binary, full, { env, cwd: scratch, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    owned.add(child);
    let output = "";
    let errors = "";
    let ready = false;
    let timedOut = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      killOwned(child, "SIGTERM");
      escalation ??= setTimeout(() => killOwned(child, "SIGKILL"), 2_000);
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, 30_000);
    const onStop = () => terminate();
    process.on("SIGINT", onStop);
    process.on("SIGTERM", onStop);
    child.stdin.on("error", () => {});
    if (!serving) child.stdin.end();
    const capture = (chunk: Buffer, stderr: boolean) => {
      if (stderr) errors = (errors + chunk.toString()).slice(-65_536);
      else output = (output + chunk.toString()).slice(0, 2_097_152);
      if (serving && !ready) {
        const url = /keyloom is running at (http:\/\/127\.0\.0\.1:\d+\/?)/.exec(errors)?.[1];
        if (url) {
          ready = true;
          clearTimeout(timer);
          console.log(JSON.stringify({ url, binary, binarySha256: sha, scratch, data: paths.data, scenario: paths.scenario, fakebin: paths.fake, layoutId: state.layoutId, conversationId: state.conversationId, results: paths.report }));
          console.error("Actual installed app; no device actions, Apply, sync, build, flash, recording or remapping. Ctrl-C stops only this session's process group.");
        }
      }
    };
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, false));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, true));
    try {
      const code = await new Promise<number | null>((resolveExit, reject) => {
        child.once("error", () => reject(new Error("Installed binary could not start")));
        child.once("close", resolveExit);
      });
      commands.push({ args: full, exitCode: code, timedOut, unknownCommand: errors.includes("unknown command") });
      check(`${args.slice(0, 2).join(" ")}: command completed within bound`, !timedOut && (code === 0 || (serving && interrupted && ready)));
      isolation();
      requireSafe(!timedOut && (code === 0 || (serving && interrupted && ready)), "Installed command failed; see sanitized command result (no raw child output retained)");
      return output;
    } finally {
      clearTimeout(timer);
      if (escalation !== undefined) clearTimeout(escalation);
      killOwned(child, "SIGKILL");
      owned.delete(child);
      process.removeListener("SIGINT", onStop);
      process.removeListener("SIGTERM", onStop);
      save();
    }
  };
  const json = async <T>(args: string[], schema: z.ZodType<T>): Promise<T> => {
    const output = await run(args);
    try {
      const parsed = schema.parse(JSON.parse(output));
      check(`${args.slice(0, 2).join(" ")}: JSON matches expected schema`, true);
      return parsed;
    } catch {
      check(`${args.slice(0, 2).join(" ")}: JSON matches expected schema`, false);
      throw new Error("Installed command did not produce valid schema-conforming JSON");
    }
  };
  const autoOff = async () => {
    const auto = z.object({ board_id: z.literal(BOARD), choice: z.literal(false), auto_sync: z.literal("off") });
    await json(["autosync", "off", BOARD], auto);
    await json(["autosync", "status", BOARD], auto);
    check("Moonlander autosync is explicitly false", true);
  };
  try {
    isolation();
    if (state.conversationId === undefined) {
      await run(["--version"]);
      const imported = await json([
        "import", "--board", BOARD, join(ROOT, "test/fixtures/oryx/synchronized"), "--name", "26a synthetic Moonlander",
      ], z.object({ layout_id: z.string().regex(/^lay_/), revision_id: z.string().regex(/^rev_/) }));
      state.layoutId = imported.layout_id;
      await autoOff();
      const chat = await json([
        "chat", state.layoutId, "--provider", "codex", "--message", PROMPT,
      ], z.object({ conversation_id: z.string(), message_ids: z.array(z.string()), status: z.literal("complete"), text: z.literal(ANSWER), provider: z.literal("codex"), proposals: z.array(z.unknown()).length(0) }));
      state.conversationId = chat.conversation_id;
      check("CLI canonical final answer is separate from the working note", true);
      const first = await json(["conversations", "show", chat.conversation_id], ConversationDetailSchema);
      const second = await json(["conversations", "show", chat.conversation_id], ConversationDetailSchema);
      const p = first.presentations?.[0];
      check("Installed history is stable across separate CLI reads", JSON.stringify(first) === JSON.stringify(second));
      check("Canonical answer and note are stored once", first.messages.filter((m) => m.role === "assistant" && m.text === ANSWER).length === 1 && first.messages.filter((m) => m.role === "assistant" && m.text === NOTE).length === 1);
      check("Completed presentation belongs to the original user message", first.presentations?.length === 1 && p?.status === "completed" && p.userMessageId === chat.message_ids[0]);
      check("One correlated successful read operation is persisted", p?.operations.length === 1 && p.operations[0]?.id === "op_1" && p.operations[0].tool === "get_layout" && p.operations[0].label === "Read layout" && p.operations[0].status === "succeeded" && p.operations[0].durationMs >= 0);
      check("Public working note and final answer retain canonical message links", p?.messages.length === 2 && p.messages[0]?.kind === "working_note" && p.messages[0].text === NOTE && p.messages[1]?.kind === "answer" && p.messages[1].text === ANSWER && p.messages.every((m) => first.messages.some((canonical) => canonical.id === m.messageId && canonical.text === m.text)));
      check("Read-only completed history has no preparation warning", p?.effectsMayHaveOccurred === false && p.warning === null && p.detailsTruncated === false);
    }
    if (values.serve) {
      const configs = await json(["config", "list", "--archived"], z.object({ configs: z.array(z.object({ board_id: z.literal(BOARD) })).min(1) }));
      check("Server scratch contains only Moonlander configs", configs.configs.length > 0);
      await autoOff();
      if (scenario !== undefined) writeFileSync(paths.scenario, JSON.stringify({ loggedIn: true, steps: scenario === "stop" ? stopping : completed }, null, 2));
      await run(["serve", "--no-open", "--port", "0", "--provider", "codex", "--exit-on-stdin-close"], true);
    }
  } catch (error) {
    check("Harness completed without command/schema/isolation failure", false);
    // Never render child output, schema input, the fake record, or an unexpected exception's content.
    console.error(error instanceof Error && error.message.startsWith("Installed ") ? error.message : "Smoke check failed; inspect sanitized results. Raw child output and exception data were not saved.");
  } finally {
    save();
    console.log(JSON.stringify({ passed: checks.length > 0 && checks.every((c) => c.pass), checks, results: paths.report, session: paths.state, scenario: paths.scenario, fakebin: paths.fake, binarySha256: sha }));
    if (checks.some((c) => !c.pass)) process.exitCode = 1;
  }
}

main().catch(() => { console.error("Smoke setup refused or failed. Use absolute paths, a fresh scratch root, and --help; no raw exception data retained."); process.exitCode = 1; });
