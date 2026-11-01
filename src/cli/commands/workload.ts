import type { Command } from "commander";
import {
  type App, type WorkloadOptions, type WorkloadReport, type WorkloadDeps, UsageError, EmulateFailedError,
  builtinWorkloadSuites, compareStoredWorkload, evaluateStoredWorkload, readWorkloadSuite,
} from "../../app/index.ts";
import { readOps } from "../ops-input.ts";
import { type Format, type Io, print } from "../output.ts";
import { progressLine, untilInterrupted } from "./firmware.ts";

export type WorkloadCommandDeps = {
  io: Io; format: () => Format;
  withApp: <T>(fn: (app: App) => Promise<T> | T) => Promise<T>;
  cli?: WorkloadDeps;
};
type Flags = { suite?: string; builtin?: string; rev?: string; boardRev?: string; ops?: string };
function summary(report: WorkloadReport): string {
  return [
    `${report.coverage.verifiedTasks}/${report.coverage.totalTasks} tasks verified (${report.coverage.verifiedOutputs}/${report.coverage.requestedOutputs} requested outputs)`,
    ...report.tasks.map((t) => `${t.id}: ${t.status}${t.costs ? `; ${t.costs.physicalKeydowns} keydowns, peak ${t.costs.maxSimultaneousKeys}${t.costsVerified ? "" : " (unverified costs)"}` : ""}${t.reason ? `; ${t.reason}` : ""}`),
    ...report.tasks.flatMap((t) => t.warnings.map((w) => `${t.id} warning: ${w}`)),
    "Selected witnesses only; not speed, comfort, application outcomes or a whole-layout score. Nothing saved or applied.",
  ].join("\n");
}
export function registerWorkloadCommands(program: Command, deps: WorkloadCommandDeps): void {
  const { io, format, withApp } = deps;
  const workload = program.command("workload").description("deterministic local workload checks through real firmware; no AI, hardware, apply or sync");
  workload.command("list").description("list tiny original US-ANSI suites (not representative activity frequencies)").action(() => {
    const suites = builtinWorkloadSuites();
    print(io, format(), { json: { suites }, rows: suites.map((s) => ({ schema_version: 1, ...s })), ids: suites.map((s) => s.id), table: suites.map((s) => `${s.id}\t${s.tasks.length} task(s)\t${s.host}`).join("\n") });
  });
  for (const name of ["evaluate", "compare"] as const) {
    const command = workload.command(name).description(name === "compare" ? "compare a validated ops patch in memory; pins are hard constraints" : "evaluate a stored snapshot, one whole-task firmware replay per planned task")
      .argument("<layout>", "layout ID or name")
      .option("--suite <file>", "version-1 suite JSON; each text or exact HID task may include a physical witness")
      .option("--builtin <id>", "built-in suite from workload list (default: prose)")
      .option("--rev <revision>", "stored revision instead of the current head")
      .option("--board-rev <revision>", "board revision (default: first declared; no device detection)")
      .addHelpText("after", '\nExamples:\n  keyloom workload list\n  keyloom workload evaluate my-layout --builtin typescript\n  keyloom workload compare my-layout --suite tasks.json --ops patch.json\n\nSuite: {"schemaVersion":1,"id":"tiny","host":"us-ansi","tasks":[{"id":"letters","kind":"text","text":"see"},{"id":"copy","kind":"hid","strokes":[{"key":"C","mods":["LCTL"]}]}]}\nWitness events: {"at":0,"position":0,"action":"press"}; positions are zero-based. Every key must be released.\nSupported search: direct/short hold-tap key sides, explicit modifiers, one momentary layer with transparent fallback. Other semantics need witnesses.\n');
    if (name === "compare") command.requiredOption("--ops <file>", "ChangeOp JSON array or {ops:[...]}, - for stdin; never saved");
    command.action(async (ref: string, flags: Flags) => {
      if (flags.suite !== undefined && flags.builtin !== undefined) throw new UsageError("pass --suite or --builtin, not both");
      const suite = flags.suite === undefined ? undefined : await readWorkloadSuite(flags.suite);
      const ops = name === "compare" && flags.ops !== undefined ? await readOps(flags.ops) : undefined;
      const progress = progressLine(io);
      try {
        const result = await untilInterrupted((signal) => withApp(async (app) => {
          const opts: WorkloadOptions = { ...(suite ? { suite } : {}), ...(flags.builtin === undefined ? {} : { builtin: flags.builtin }),
            ...(flags.rev === undefined ? {} : { revisionId: flags.rev }), ...(flags.boardRev === undefined ? {} : { boardRevision: flags.boardRev }),
            onProgress: progress.write, onDiagnostic: (message) => { progress.end(); io.err(`${message}\n`); }, signal };
          if (ops) {
            const r = await compareStoredWorkload(app, ref, ops, opts, deps.cli);
            return { json: { ...r }, table: `Baseline\n${summary(r.baseline)}\nCandidate\n${summary(r.candidate)}\nComparison: ${r.comparison.verdict} (keydown and peak-chord objectives, every task protected)`, executionFailed: [...r.baseline.tasks, ...r.candidate.tasks].some((t) => t.status === "execution-error") };
          }
          const r = await evaluateStoredWorkload(app, ref, opts, deps.cli);
          return { json: { ...r }, table: summary(r), executionFailed: r.tasks.some((t) => t.status === "execution-error") };
        }));
        progress.end(); print(io, format(), result);
        if (result.executionFailed) throw new EmulateFailedError("workload firmware build or replay failed; inspect per-task evidence and diagnostics");
      } finally { progress.end(); }
    });
  }
}
