// `keyloom remap`: the MacBook's built-in keyboard through kanata (21). Applying a layout is `keyloom sync`; these are the
// parts around it: the setup keyloom can do without root, the setup doctor, the emergency switch and the exit-chord proof.
import type { HandsFreeOverrides } from "../../app/index.ts";
import {
  EXIT_CHORD_WINDOW_MS, applyToRemapper, confirmExitChord, disableRemapperFor, lookAtRemapper, remapperDoctor, setupRemapper, UsageError,
} from "../../app/index.ts";
import type { Command } from "commander";
import type { CliContext } from "./context.ts";
import { print } from "../output.ts";
import { ROOT_KANATA_PATH, noteKanataSeen } from "../../app/remapper.ts";

const DEFAULT_BOARD = "apple/macbook-ansi";

export type RemapCommandDeps = CliContext & { handsFree?: HandsFreeOverrides };

export function registerRemapCommands(program: Command, deps: RemapCommandDeps): void {
  const { io, format, withApp, handsFree } = deps;
  const over = handsFree?.remapper ?? {};
  const remap = program.command("remap").description("the MacBook's built-in keyboard through kanata: setup, doctor, disable, and the exit-chord proof");

  remap
    .command("setup")
    .description("write the LaunchDaemon file into keyloom's folder and print the one command to run as root, which copies kanata to a root-owned place; keyloom never runs sudo")
    .option("--board <board>", "board ID", DEFAULT_BOARD)
    .action(async (opts: { board: string }) => {
      const r = await setupRemapper(opts.board, over);
      print(io, format(), {
        json: { plist_path: r.plistPath, kanata_path: r.kanataPath ?? null, root_command: r.rootCommand, blocked: r.blocked },
        table: [
          `wrote ${r.plistPath}`,
          r.wroteConfig ? "wrote an identity keyloom.kbd and safe.kbd (nothing remapped) so the daemon has a config to start with" : "keyloom.kbd already exists; it was left alone",
          ...(r.blocked?.code === "no_kanata" ? ["kanata isn't installed yet: brew install kanata, then run `keyloom remap setup` again"] : r.kanataPath ? [`kanata: ${r.kanataPath}`] : []),
          "",
          ...(r.rootCommand === null
            ? r.blocked?.code === "no_kanata" ? [] : [`no root command: ${r.blocked?.reason ?? "keyloom couldn't prepare one"}`]
            : [
              `Read the file, then run this once as an administrator. keyloom never runs it. It copies kanata to ${ROOT_KANATA_PATH}, checks the copy is`,
              "the kanata keyloom checked, installs the same plist text (carried encoded), and starts the daemon. Run it again after you upgrade kanata.",
              `  ${r.rootCommand}`,
            ]),
          "",
          "Then prove the way out before you rely on it: once kanata runs, run `keyloom remap confirm-exit-chord`, hold Left Control + Space + Escape until kanata stops, and run it again.",
        ].join("\n"),
      });
    });

  remap
    .command("doctor")
    .description("read-only check of kanata, the driver, the daemon and the port; prints the root command when one is needed")
    .option("--board <board>", "board ID", DEFAULT_BOARD)
    .action(async (opts: { board: string }) => {
      const r = await remapperDoctor(opts.board, over);
      print(io, format(), {
        json: { findings: r.findings, root_command: r.rootCommand, blocked: r.blocked },
        table: [
          ...r.findings.map((f) => `${f.status.toUpperCase().padEnd(7)} ${f.name}: ${f.detail}${f.fix ? `\n        fix: ${f.fix}` : ""}`),
          ...(r.rootCommand ? ["", "Run once as an administrator after `keyloom remap setup`:", `  ${r.rootCommand}`] : []),
          ...(r.blocked !== null && r.blocked.code !== "no_kanata" ? ["", `no root command: ${r.blocked.reason}`] : []),
        ].join("\n"),
      });
    });

  remap
    .command("apply")
    .description("write, check and reload one layout now, without the sync engine; --overwrite replaces a keyloom.kbd keyloom didn't write, keeping a copy")
    .argument("<layout>", "layout ID or name")
    .option("--overwrite", "replace a keyloom.kbd keyloom didn't write")
    .action(async (ref: string, opts: { overwrite?: boolean }) => {
      const r = await withApp((app) => applyToRemapper(app, ref, undefined, over, opts.overwrite ? { overwriteForeign: true } : {}));
      if (!r.ok) throw new UsageError(`${r.step}: ${r.error}`);
      print(io, format(), { json: { ok: true, revision_id: r.revisionId, ms: r.ms }, table: `applied ${r.revisionId} in ${r.ms} ms; kanata reports it` });
    });

  remap
    .command("disable")
    .description("Disable remapping: load the identity map so the built-in keyboard types plainly. No sudo; `keyloom sync <layout>` turns it back on")
    .option("--board <board>", "board ID", DEFAULT_BOARD)
    .action(async (opts: { board: string }) => {
      const r = await disableRemapperFor(opts.board, over);
      if (!r.ok) throw new UsageError(`couldn't disable remapping: ${r.error}. If kanata is stuck, hold Left Control + Space + Escape to stop it`);
      print(io, format(), { json: { ok: true }, table: "remapping is off: kanata is running the identity map. `keyloom sync <layout>` turns it back on." });
    });

  remap
    .command("confirm-exit-chord")
    .description("record that you held Left Control + Space + Escape and saw kanata stop; run it once while kanata runs, then again after the chord. Auto-apply can turn on after this")
    .option("--board <board>", "board ID", DEFAULT_BOARD)
    .action(async (opts: { board: string }) => {
      // The same checks as the app's button (D-497, D-509): only a refused port shows kanata stopped, and only a kanata keyloom saw
      // running its config shortly before shows the chord stopped it. Run while kanata runs keyloom's config, this is that sighting.
      const minutes = EXIT_CHORD_WINDOW_MS / 60_000;
      const look = await lookAtRemapper(opts.board, over);
      if (look === "keyloom") {
        await withApp((app) => noteKanataSeen(app, opts.board));
        throw new UsageError(`kanata is still running keyloom's config, so the chord hasn't stopped it yet. Hold Left Control + Space + Escape until the MacBook keyboard types plainly, then run this again within ${minutes} minutes`);
      }
      if (look === "other") throw new UsageError("kanata is still running a config keyloom didn't write. The proof counts only for a kanata keyloom saw running its own config: `keyloom remap apply <layout> --overwrite` puts one on, then run this again");
      if (look === "unreadable") throw new UsageError("keyloom couldn't tell whether kanata stopped: its port didn't answer either way. Nothing was recorded; run this again in a moment");
      const outcome = await withApp((app) => confirmExitChord(app, opts.board));
      if (outcome === "not_seen") {
        throw new UsageError(`kanata isn't running, but keyloom hasn't seen it run keyloom's config in the last ${minutes} minutes, so this doesn't show the chord stopped it. Nothing was recorded. Start kanata (\`keyloom remap doctor\` says how), run this while it runs, then hold the chord and run this again`);
      }
      print(io, format(), { json: { ok: true }, table: "recorded. `keyloom autosync on apple/macbook-ansi` can turn auto-apply on." });
    });
}
