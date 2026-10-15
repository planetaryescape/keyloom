import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { type ScriptStep, fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";

async function cli(args: string[], deps: Parameters<typeof runCli>[2] = {}) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io, deps), out, err };
}

const say: ScriptStep[] = [
  { blocks: [
    { tool: "record_priority", input: { priorityKind: "pinned", statement: "keep Backspace where it is", subject: { functions: ["key:BACKSPACE"] } } },
    { tool: "record_priority", input: { priorityKind: "rarely_used", statement: "I barely use F16", subject: { functions: ["key:F16"] } } },
  ] },
  { blocks: [{ text: "Noted both." }] },
];

/** A layout where BK has stated two priorities in a chat, as the demo does. */
async function withPriorities() {
  const { dir, app, layoutId } = await commandShiftApp();
  app.db.close();
  const chat = await cli(["chat", layoutId, "--message", "Keep Backspace; I barely use F16", "--format", "json", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(say).client) });
  expect(chat.code).toBe(0);
  return { dir, layoutId, chat: JSON.parse(chat.out) };
}

describe("keyloom decisions", () => {
  test("list --kind priority shows what BK stated in the chat, newest first", async () => {
    const { dir, layoutId, chat } = await withPriorities();
    expect(chat.priorities.map((p: { priority_kind: string }) => p.priority_kind)).toEqual(["pinned", "rarely_used"]);

    const json = await cli(["decisions", "list", layoutId, "--kind", "priority", "--format", "json", "--data-dir", dir]);
    expect(json.code).toBe(0);
    const body = JSON.parse(json.out);
    expect(body.schema_version).toBe(1);
    expect(body.decisions.map((d: { goal: string }) => d.goal)).toEqual(["I barely use F16", "keep Backspace where it is"]);
    expect(body.decisions[1]).toMatchObject({ kind: "priority", priority_kind: "pinned", subject: { functions: ["key:BACKSPACE"] }, reason: "stated by BK", status: "hypothesis" });

    const table = await cli(["decisions", "list", layoutId, "--kind", "priority", "--format", "table", "--data-dir", dir]);
    expect(table.out).toContain("pinned");
    expect(table.out).toContain("key:BACKSPACE");
    expect(table.out).toContain("keep Backspace where it is");

    expect((await cli(["decisions", "list", layoutId, "--kind", "choice", "--format", "json", "--data-dir", dir])).out).toContain('"decisions": []');
  });

  test("show, edit and retire a priority; retired ones leave the default list", async () => {
    const { dir, layoutId } = await withPriorities();
    const ids = (await cli(["decisions", "list", layoutId, "--format", "ids", "--data-dir", dir])).out.trim().split("\n");
    expect(ids).toHaveLength(2);
    const id = ids[1] as string;

    expect(JSON.parse((await cli(["decisions", "show", id, "--format", "json", "--data-dir", dir])).out).decision.goal).toBe("keep Backspace where it is");
    const edited = await cli(["decisions", "edit", id, "--reason", "my pinky knows it", "--format", "json", "--data-dir", dir]);
    expect(JSON.parse(edited.out).decision.reason).toBe("my pinky knows it");
    expect((await cli(["decisions", "edit", id, "--format", "json", "--data-dir", dir])).code).toBe(2);

    const retired = await cli(["decisions", "retire", id, "--format", "json", "--data-dir", dir]);
    expect(JSON.parse(retired.out)).toMatchObject({ decision_id: id, status: "retired" });
    expect((await cli(["decisions", "list", layoutId, "--format", "ids", "--data-dir", dir])).out.trim().split("\n")).toHaveLength(1);
    expect((await cli(["decisions", "list", layoutId, "--status", "retired", "--format", "ids", "--data-dir", dir])).out.trim()).toBe(id);
  });

  test("an unknown decision exits 3", async () => {
    const { dir } = await withPriorities();
    expect((await cli(["decisions", "show", "dec_missing", "--format", "json", "--data-dir", dir])).code).toBe(3);
    expect((await cli(["decisions", "retire", "dec_missing", "--format", "json", "--data-dir", dir])).code).toBe(3);
  });
});

describe("choices through the CLI (rung 6)", () => {
  const OPS = JSON.stringify([{ op: "setBinding", at: { layerId: "layer-0", position: 42 }, binding: { kind: "modifier", mods: ["LGUI", "LSFT"] } }]);
  const CAPS = JSON.stringify([
    { op: "dropFunction", function: "mod:LSFT+LGUI", reason: "unused" },
    { op: "setBinding", at: { layerId: "layer-0", position: 42 }, binding: { kind: "key", code: "CAPS_LOCK" } },
  ]);

  async function withChoice() {
    const { dir, app, layoutId } = await commandShiftApp();
    app.db.close();
    const run = async (args: string[], stdin?: string) => {
      const path = `${dir}/ops-${Math.random().toString(36).slice(2)}.json`;
      if (stdin !== undefined) await Bun.write(path, stdin);
      return cli(args.map((a) => (a === "OPS" ? path : a)).concat(["--format", "json", "--data-dir", dir]));
    };
    const proposed = await run(["change", "propose", layoutId, "--ops", "OPS", "--explain", "Command-Shift on key 43", "--reason", "my left hand is free"], OPS);
    expect(proposed.code).toBe(0);
    const csId = JSON.parse(proposed.out).change_set_id as string;
    expect(JSON.parse(proposed.out).change_set.decision_draft).toMatchObject({ reason: "my left hand is free", choice: "Command-Shift on key 43" });
    const applied = await run(["change", "apply", csId]);
    expect(applied.code).toBe(0);
    return { dir, layoutId, run, decisionId: JSON.parse(applied.out).decision_id as string };
  }

  test("applying a change proposed with --reason writes a choice that shows in list and show", async () => {
    const { layoutId, run, decisionId } = await withChoice();
    expect(decisionId).toMatch(/^dec_/);
    const list = JSON.parse((await run(["decisions", "list", layoutId, "--kind", "choice"])).out);
    expect(list.decisions).toHaveLength(1);
    expect(list.decisions[0]).toMatchObject({ id: decisionId, kind: "choice", status: "hypothesis", reason: "my left hand is free", superseded_by: null });
  });

  test("a later change shows the reminder in its check, and applying it supersedes the old decision", async () => {
    const { layoutId, run, decisionId } = await withChoice();
    const check = await run(["change", "check", layoutId, "--ops", "OPS"], CAPS);
    expect(check.code).toBe(0);
    expect(JSON.parse(check.out).validation.diff.reminders).toMatchObject([{ decisionId, reason: "my left hand is free" }]);
    const proposed = await run(["change", "propose", layoutId, "--ops", "OPS", "--explain", "Caps Lock on key 43", "--reason", "never used Command-Shift"], CAPS);
    const applied = await run(["change", "apply", JSON.parse(proposed.out).change_set_id]);
    const shown = JSON.parse((await run(["decisions", "show", decisionId])).out).decision;
    expect(shown).toMatchObject({ status: "superseded", superseded_by: JSON.parse(applied.out).decision_id });
  });

  test("outcome records BK's words; due and dismiss follow the 7-day question", async () => {
    const { layoutId, run, decisionId } = await withChoice();
    expect((await run(["decisions", "due", layoutId])).out).toContain('"due": []');
    const bad = await run(["decisions", "outcome", decisionId, "--status", "tried_helpful", "--note", " "]);
    expect(bad.code).not.toBe(0);
    const done = JSON.parse((await run(["decisions", "outcome", decisionId, "--status", "tried_unhelpful", "--note", "feels slow now"])).out).decision;
    expect(done).toMatchObject({ status: "tried_unhelpful", outcome_note: "feels slow now" });
    expect((await run(["decisions", "due", layoutId, "--now", "not a time"])).code).not.toBe(0);
    const dismissed = JSON.parse((await run(["decisions", "dismiss", decisionId])).out).decision;
    expect(dismissed.outcome_asked_at).toBeGreaterThan(0);
  });
});
