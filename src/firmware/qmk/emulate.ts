// `keyloom emulate` for QMK: the generated keymap.c runs on QMK's own core, built for this machine
// with QMK's host test harness, in the same Docker image and pinned checkout the firmware build uses
// (05#emulate). Nothing is flashed and no keyboard is needed.
import { join } from "node:path";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import type { EmulationResult, EmulatorEvent } from "../emulate/types.ts";
import { BuildFailure } from "../toolchain/build-failure.ts";
import { type CheckoutSpec, ensureCheckout } from "../toolchain/checkout.ts";
import { withLock } from "../toolchain/lock.ts";
import { type LogSink, run } from "../toolchain/run.ts";
import { qmkRevision } from "./board-config.ts";
import { OUTPUT_BEGIN, OUTPUT_END, carriedRules, harnessFiles, harnessName, harnessScript, rulesWithDefaults } from "./emulate-harness.ts";
import { parseHarnessOutput, typedText } from "./emulate-reports.ts";
import { type GeneratedSource, generateQmkSource } from "./generate.ts";
import { describeLocated, locateCompileError } from "./locate-error.ts";
import { writeSource } from "./write-source.ts";
import { writeFresh } from "../toolchain/write-fresh.ts";

export const EMULATE_TIMEOUT_MS = 5 * 60_000;
/** Simulated time after the last event, so a tap-hold or one-shot that is still waiting gets to resolve. */
export const DEFAULT_SETTLE_MS = 1000;

/** QMK's host tests need googletest, which the firmware build never fetches. */
const TEST_SUBMODULES = ["lib/googletest"];

export type EmulateQmkInput = {
  board: BoardDefinition;
  boardRevisionId?: string;
  /** What to run: the generated keymap folder, or a layout to generate it from. */
  source?: GeneratedSource;
  layout?: Layout;
  revisionId?: string;
  checkoutDir: string;
  events: EmulatorEvent[];
  settleMs?: number;
  log?: LogSink;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** The events in the order the harness plays them, from time zero, or a message saying which one is wrong. */
export function scriptFor(events: readonly EmulatorEvent[], keyCount: number): string {
  if (events.length === 0) throw new BuildFailure("There are no key events to run.");
  events.forEach((e, i) => {
    if (!Number.isInteger(e.position) || e.position < 0 || e.position >= keyCount) {
      throw new BuildFailure(`Event ${i + 1}: position ${e.position} is not a key on this board (0 to ${keyCount - 1}).`);
    }
    if (!Number.isFinite(e.at) || e.at < 0) throw new BuildFailure(`Event ${i + 1}: time ${e.at} must be zero or more milliseconds.`);
  });
  // Array.prototype.sort is stable, so events at the same time keep the order they were given in.
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const first = (sorted[0] as EmulatorEvent).at;
  return `${sorted.map((e) => `${Math.round(e.at - first)} ${e.position} ${e.action}`).join("\n")}\n`;
}

const UNDEFINED = /undefined reference to `([^']+)'/;

/** A message fit for a person, from the tail of a failed compile or link. */
export function failureMessage(output: readonly string[], name: string, keymapC: string, board: BoardDefinition): string {
  const link = output.map((l) => UNDEFINED.exec(l)).find((m) => m !== null);
  if (link) return `The emulator can't link the generated keymap: it uses \`${link[1]}\`, which only exists on the keyboard itself.`;
  // The compile error locator expects the path a real build prints.
  const rewritten = output.map((l) => l.replaceAll(`tests/${name}/keymap.c`, "keymaps/keyloom/keymap.c"));
  const located = locateCompileError(rewritten, keymapC, board);
  if (located) return `The generated keymap doesn't compile for the emulator: ${describeLocated(located)}`;
  const error = output.find((l) => /error:|\*\*\*/.test(l));
  return `QMK's test harness failed: ${(error ?? output.filter((l) => l.trim() !== "").slice(-3).join(" | ")).trim()}`;
}

export async function emulateQmk(input: EmulateQmkInput): Promise<EmulationResult> {
  const { board } = input;
  const rev = qmkRevision(board, input.boardRevisionId);
  const source =
    input.source ??
    (input.layout
      ? generateQmkSource({ layout: input.layout, board, revisionId: input.revisionId ?? "emulate", boardRevisionId: rev.id })
      : undefined);
  if (!source) throw new BuildFailure("emulateQmk needs a layout or its generated source.");
  const script = scriptFor(input.events, board.keyCount);

  const name = harnessName(rev.qmkTarget, `${Date.now().toString(36)}${process.pid}`);
  const rules = carriedRules(source.files.find((f) => f.path === "rules.mk")?.content);
  const files = harnessFiles(
    {
      name,
      keymapFiles: source.files,
      layoutMacro: rev.build.layoutMacro,
      keyCount: board.keyCount,
      zsa: board.vendor === "ZSA",
      modules: rev.build.modules ?? [],
    },
    rulesWithDefaults(rules.carried),
  );

  const say = (line: string) => {
    input.log?.line(line);
    input.onLine?.(line);
  };
  const spec: CheckoutSpec = { dir: input.checkoutDir, repo: rev.source.repo, sha: rev.source.sha, submodules: [...rev.build.submodules, ...TEST_SUBMODULES] };
  const timeoutMs = input.timeoutMs ?? EMULATE_TIMEOUT_MS;
  const containerName = `keyloom-emu-${process.pid}-${Date.now()}`;

  return withLock(
    `${input.checkoutDir}.lock`,
    async () => {
      await ensureCheckout(spec, { ...(input.log ? { log: input.log } : {}), ...(input.onLine ? { onLine: input.onLine } : {}), ...(input.signal ? { signal: input.signal } : {}) });

      const dir = join(input.checkoutDir, "tests", name);
      await writeSource(dir, { keymapName: name, files: files });
      await writeFresh(join(dir, "events.txt"), script);

      const inContainer = `/qmk_firmware/tests/${name}`;
      const uid = process.getuid?.() ?? 1000;
      const gid = process.getgid?.() ?? 1000;
      const cmd = [
        "docker", "run", "--rm", "--name", containerName, "--user", `${uid}:${gid}`, "-w", "/qmk_firmware", "-v", `${input.checkoutDir}:/qmk_firmware`,
        "-e", "SKIP_GIT=1", "-e", `KEYLOOM_EMU_EVENTS=${inContainer}/events.txt`, "-e", `KEYLOOM_EMU_OUT=${inContainer}/out.txt`,
        "-e", `KEYLOOM_EMU_SETTLE_MS=${input.settleMs ?? DEFAULT_SETTLE_MS}`,
        rev.build.image, "sh", "-c", harnessScript(name, rev.qmkTarget),
      ];
      say(`keyloom: emulating ${rev.qmkTarget} in ${rev.build.image.split("@")[0]}`);
      const output: string[] = [];
      const result = await run({
        cmd,
        ...(input.log ? { log: input.log } : {}),
        timeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
        onLine: (line) => {
          output.push(line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""));
          input.onLine?.(line);
        },
        onKill: async () => {
          await run({ cmd: ["docker", "rm", "-f", containerName] }).catch(() => undefined);
        },
      });
      if (result.timedOut) throw new BuildFailure(`The emulator took longer than ${Math.round(timeoutMs / 60_000)} minutes and was stopped.`);
      if (result.aborted) throw new BuildFailure("The emulation was cancelled.");

      const begin = output.indexOf(OUTPUT_BEGIN);
      const end = output.indexOf(OUTPUT_END);
      if (result.exitCode !== 0 || begin < 0 || end < begin) {
        if (output.some((l) => /Cannot connect to the Docker daemon/i.test(l))) throw new BuildFailure("Docker isn't running. Start Docker Desktop and try again.");
        // gtest says why the script itself failed (a position that is not on the matrix).
        const assertion = output.findIndex((l) => /Failure$/.test(l));
        if (assertion >= 0 && output[assertion + 1] !== undefined) throw new BuildFailure(`The emulator stopped: ${output.slice(assertion + 1, assertion + 4).join(" ").trim()}`);
        throw new BuildFailure(failureMessage(output, name, source.files.find((f) => f.path === "keymap.c")?.content ?? "", board));
      }

      const parsed = parseHarnessOutput(output.slice(begin + 1, end).join("\n"));
      const warnings = [
        ...(board.vendor === "ZSA" ? ["Oryx's RGB, layer LED and raw HID code is replaced by no-ops. It never changes what keys send."] : []),
        ...(rules.dropped.length > 0 ? [`rules.mk settings that are hardware only were not applied: ${rules.dropped.slice(0, 6).join("; ")}${rules.dropped.length > 6 ? "; ..." : ""}`] : []),
        "Matrix scanning, debounce and USB are not modelled: QMK sees each key event on a 1 ms scan.",
        ...parsed.warnings,
      ];
      return { firmware: "qmk" as const, reports: parsed.reports, text: typedText(parsed.reports), warnings };
    },
    { timeoutMs: EMULATE_TIMEOUT_MS, onWait: (pid) => say(`keyloom: waiting for another build to finish${pid ? ` (pid ${pid})` : ""}`) },
  );
}
