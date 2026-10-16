// keyloom lab, end to end on a fake keyboard and a stand-in firmware (D-280 to D-286): record a session, analyse it, find the proposals,
// ask the agent's tool what it found, and delete everything. The terminal is scripted and the keyboard speaks the real stream protocol.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyOps, getLayout, listChanges, proposeChange } from "../../src/app/index.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { typingFindingsText } from "../../src/agent/tools/get-typing-findings.ts";
import { runCli } from "../../src/cli/main.ts";
import type { LabCliDeps, LabTerminal } from "../../src/cli/commands/lab.ts";
import type { Io } from "../../src/cli/output.ts";
import { startQmkCapture } from "../../src/firmware/qmk/typing-capture.ts";
import { listTypingSessions } from "../../src/persistence/typing-sessions.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { fakeMoonlander, moonlanderInterface } from "../helpers/fake-key-stream.ts";
import { letterPositions, modelReplay } from "../helpers/typing-lab.ts";

type Result = { code: number; out: string; err: string };

async function world() {
  const fixture = await commandShiftApp();
  const { app, layoutId } = fixture;
  // BK's layout has chordal hold on, which already keeps a same-hand roll a tap. Take it off so the recording has misfires to find.
  const view = getLayout(app, layoutId);
  applyOps(app, layoutId, {
    baseRevisionId: view.revision.id, summary: "No chordal hold, no permissive hold",
    ops: [
      { op: "removeFirmwareSetting", firmware: "qmk", key: "CHORDAL_HOLD" },
      { op: "removeFirmwareSetting", firmware: "qmk", key: "PERMISSIVE_HOLD" },
      ...view.document.holdTapProfiles.map((p) => ({ op: "upsertHoldTapProfile" as const, profile: { ...p, options: {} } })),
    ],
  });
  const board = view.board.definition;
  const keyboard = fakeMoonlander();
  const at = letterPositions(getLayout(app, layoutId).document);
  /** The terminal types "sdsd..." by pressing keys on the fake keyboard the way the roll test does: S held 260 ms with D inside it. */
  const terminal: LabTerminal = {
    isInteractive: true,
    async typing(onText) {
      const base = 1_000_000;
      const events = Array.from({ length: 6 }, (_, i) => {
        const t = base + i * 450;
        return [
          { position: at.s as number, pressed: true, atMs: t }, { position: at.d as number, pressed: true, atMs: t + 150 },
          { position: at.d as number, pressed: false, atMs: t + 190 }, { position: at.s as number, pressed: false, atMs: t + 260 },
        ];
      }).flat();
      keyboard.press(events);
      await new Promise((r) => setTimeout(r, 30));
      onText("sdsdsdsdsdsd");
      return "sdsdsdsdsdsd";
    },
  };
  const replays = { runs: 0 };
  const lab: LabCliDeps = {
    terminal,
    lab: {
      startCapture: (_board, hooks) => startQmkCapture(keyboard.transport, moonlanderInterface(), hooks),
      replay: () => {
        const model = modelReplay(board);
        return async (doc, events) => {
          replays.runs++;
          return model(doc, events);
        };
      },
    },
  };
  return { app, layoutId, keyboard, lab, replays, board };
}

async function cli(w: Awaited<ReturnType<typeof world>>, args: string[]): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  const code = await runCli([...args, "--data-dir", w.app.dataDir], io, {}, undefined, undefined, w.lab);
  return { code, out, err };
}
const json = (r: Result) => JSON.parse(r.out);

describe("keyloom lab, end to end", () => {
  test("records, analyses, proposes, answers the agent and deletes", async () => {
    const w = await world();

    const started = await cli(w, ["lab", "start", w.layoutId, "--text", "sdsdsdsdsdsd", "--format", "json"]);
    expect(started.code).toBe(0);
    // The notice came first, and it names what is recorded and how to delete it.
    expect(started.err).toContain("keyloom is recording this keyboard's key presses");
    expect(started.err).toContain("Nothing is sent anywhere");
    expect(started.err).toContain("keyloom lab delete");
    expect(started.out).toContain("typed:");
    const session = json({ ...started, out: started.out.slice(started.out.indexOf("{")) });
    // Read before the matcher: bun's toMatchObject replaces a value it matched against an asymmetric matcher.
    const id: string = session.session_id;
    expect(session).toMatchObject({ session_id: expect.stringMatching(/^typ_/), key_events: 24, ended_by: "host" });
    expect(w.keyboard.isOn()).toBe(false);
    expect(w.keyboard.stream.closed()).toBe(1);

    const listed = json(await cli(w, ["lab", "sessions", "--format", "json"]));
    expect(listed.sessions).toEqual([expect.objectContaining({ session_id: id, analysed: false, key_events: 24 })]);

    const analysed = await cli(w, ["lab", "analyse", id, "--format", "json"]);
    expect(analysed.err).toBe("");
    expect(analysed.code).toBe(0);
    const a = json(analysed);
    expect(a.counts).toMatchObject({ misfireHold: 6 });
    expect(a.findings[0].sentence).toContain("Option fired 6 times when you meant to type S");
    expect(a.suggestions.map((s: { title: string }) => s.title)).toContain("Raise the tapping term of Home-row mods from 200 to 280 ms");
    expect(a.emulator_runs).toBeGreaterThan(1);
    // Every suggestion is an ordinary proposal on the head, with the evidence in words.
    const proposed = listChanges(w.app, w.layoutId, { status: "proposed" });
    expect(proposed.length).toBe(a.suggestions.length);
    const term = proposed.find((c) => c.title?.startsWith("Raise the tapping term"));
    expect(term?.explanation).toContain("6 of 6 misfires gone, none new");
    expect(term?.tradeoffs).toEqual({ gains: ["6 of 6 misfires gone on your own typing"], costs: [] });
    expect(term?.validation.ok).toBe(true);

    // The table view reads as findings first, then proof.
    const table = await cli(w, ["lab", "analyse", id, "--show", "--format", "table"]);
    expect(table.out).toContain("What stood out:");
    expect(table.out).toContain("Tried on this recording:");
    expect(table.out).toContain("6 of 6 misfires gone, none new");

    // Analysing again replaces the proposals it made before instead of piling up copies.
    await cli(w, ["lab", "analyse", id, "--format", "json"]);
    expect(listChanges(w.app, w.layoutId, { status: "proposed" }).length).toBe(a.suggestions.length);
    expect(listChanges(w.app, w.layoutId, { status: "rejected" }).length).toBe(a.suggestions.length);

    // The agent's tool: aggregated, with key names, and nothing of what was typed.
    const text = typingFindingsText(createAgentPorts(w.app, w.layoutId, "conv_x").typingFindings());
    expect(text).toContain("6 holds where a tap was meant");
    expect(text).toContain("e.g. S then D");
    expect(text).not.toContain("sdsd");
    expect(text).not.toContain("sd sd");

    const deleted = await cli(w, ["lab", "delete", id, "--format", "json"]);
    expect(deleted.code).toBe(0);
    expect(listTypingSessions(w.app.db)).toEqual([]);
    expect(createAgentPorts(w.app, w.layoutId, "conv_x").typingFindings()).toEqual({ sessions: 0, analysed: 0 });
    expect((await cli(w, ["lab", "delete", id])).code).toBe(3);
  });

  test("two analyses of one session at once leave one set of proposals, and an analysis from another version is not trusted", async () => {
    const w = await world();
    const started = await cli(w, ["lab", "start", w.layoutId, "--text", "sdsdsdsdsdsd", "--format", "json"]);
    const id: string = json({ ...started, out: started.out.slice(started.out.indexOf("{")) }).session_id;
    const both = await Promise.all([cli(w, ["lab", "analyse", id, "--format", "json"]), cli(w, ["lab", "analyse", id, "--format", "json"])]);
    expect(both.map((r) => r.code)).toEqual([0, 0]);
    const suggestions = json(both[0] as Result).suggestions.length;
    expect(suggestions).toBeGreaterThan(0);
    expect(listChanges(w.app, w.layoutId, { status: "proposed" })).toHaveLength(suggestions);

    // An analysis written by another version of keyloom is treated as not made: the tool says nothing about it and --show asks for a new one.
    w.app.db.query("UPDATE typing_sessions SET analysis = ? WHERE id = ?").run(JSON.stringify({ schemaVersion: 99, counts: "?" }), id);
    expect(createAgentPorts(w.app, w.layoutId, "conv_x").typingFindings()).toEqual({ sessions: 1, analysed: 0 });
    const shown = await cli(w, ["lab", "analyse", id, "--show", "--format", "json"]);
    expect(shown.code).toBe(2);
    expect(JSON.parse(shown.err).error.message).toContain("has not been analysed");
  });

  test("the emulator's log is not left behind: a good analysis removes it, a failed one keeps it for the person, and delete removes it too", async () => {
    const w = await world();
    const started = await cli(w, ["lab", "start", w.layoutId, "--text", "sdsdsdsdsdsd", "--format", "json"]);
    const id: string = json({ ...started, out: started.out.slice(started.out.indexOf("{")) }).session_id;
    const log = join(w.app.dataDir, "logs", `lab-${id}.log`);
    expect((await cli(w, ["lab", "analyse", id, "--format", "json"])).code).toBe(0);
    expect(existsSync(log)).toBe(false);

    const good = w.lab.lab as NonNullable<LabCliDeps["lab"]>;
    w.lab.lab = { ...good, replay: (_app, _view, _rev, hooks) => async () => { hooks.log.line("firmware said: s d"); throw new Error("the emulator broke"); } };
    expect((await cli(w, ["lab", "analyse", id, "--format", "json"])).code).toBe(1);
    expect(readFileSync(log, "utf8")).toContain("firmware said");

    expect((await cli(w, ["lab", "delete", id, "--format", "json"])).code).toBe(0);
    expect(existsSync(log)).toBe(false);
  });

  test("a keyboard without the lab's firmware records nothing, says why, and is left off", async () => {
    const w = await world();
    const silent = fakeMoonlander({ answers: false });
    w.lab.lab = { ...(w.lab.lab as NonNullable<LabCliDeps["lab"]>), startCapture: (_b, hooks) => startQmkCapture(silent.transport, moonlanderInterface(), { ...hooks, startTimeoutMs: 40 }) };
    const r = await cli(w, ["lab", "start", w.layoutId, "--format", "json"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("the keyboard didn't start streaming");
    expect(listTypingSessions(w.app.db)).toEqual([]);
    expect(silent.stream.closed()).toBe(1);
  });

  test("a recording with no key presses is not saved", async () => {
    const w = await world();
    w.lab.terminal = { isInteractive: true, typing: async () => "" };
    const r = await cli(w, ["lab", "start", w.layoutId, "--format", "json"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("no key presses were recorded");
    expect(listTypingSessions(w.app.db)).toEqual([]);
    expect(w.keyboard.isOn()).toBe(false);
  });

  test("it needs a terminal, and a MacBook cannot be recorded", async () => {
    const w = await world();
    w.lab.terminal = { isInteractive: false, typing: async () => "" };
    const r = await cli(w, ["lab", "start", w.layoutId]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("needs a terminal");
    expect(w.keyboard.stream.opened()).toBe(0);
  });

  test("unknown passages and sessions are usage and not-found errors", async () => {
    const w = await world();
    const bad = await cli(w, ["lab", "start", w.layoutId, "--passage", "nope"]);
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.err).error.message).toContain("no passage \"nope\"; use one of: starter, home-row-holds");
    expect((await cli(w, ["lab", "analyse", "typ_missing"])).code).toBe(3);
    const passages = json(await cli(w, ["lab", "passages", w.layoutId, "--format", "json"]));
    expect(passages.passages.map((p: { id: string }) => p.id)).toContain("home-row-rolls");
  });
});

void proposeChange;
