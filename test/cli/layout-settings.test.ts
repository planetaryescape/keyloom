// `keyloom layout settings` (10, D-030, D-459): the Settings page's view of a layout from the CLI, read only. Each firmware option
// with the value in force, the baseline, whether the layout stores it, and why it is forced.
import { afterEach, describe, expect, test } from "bun:test";
import { type App, applyOps, closeApp, getLayout, importLayout, openApp } from "../../src/app/index.ts";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { dropFunctions } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";

const opened: App[] = [];
afterEach(() => {
  for (const app of opened.splice(0)) closeApp(app);
});

async function world() {
  const dataDir = tempDir();
  const app = openApp({ dataDir });
  opened.push(app);
  const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "my-moonlander" });
  return { app, dataDir, layoutId };
}

async function cli(args: string[], dataDir: string) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  const code = await runCli([...args, "--data-dir", dataDir], io);
  return { code, out, err };
}

type Row = { key: string; name: string; value: number | boolean | null; default: number | boolean; stored: boolean; forced_by: string | null; source_text: string | null };
const rows = async (dataDir: string, ref: string, extra: string[] = []): Promise<Record<string, Row>> => {
  const r = await cli(["--format", "json", "layout", "settings", ref, ...extra], dataDir);
  expect(r.code).toBe(0);
  // SAFETY: the JSON shape is what these tests assert; a missing field fails the matcher that reads it.
  return Object.fromEntries((JSON.parse(r.out).settings as Row[]).map((s) => [s.key, s]));
};

/** Position 45 is a base-layer key on the Moonlander fixture. */
const putCapsWord = (app: App, layoutId: string) => {
  const head = getLayout(app, layoutId);
  const old = head.document.layers[0]?.bindings[45];
  const ops: ChangeOp[] = [
    ...dropFunctions(old ? bindingFunctions(old, head.document.tapDances) : []),
    { op: "setBinding", at: { layerId: "layer-0", position: 45 }, binding: { kind: "native", firmware: "qmk", source: "CW_TOGG", label: "CapsW" } },
  ];
  applyOps(app, layoutId, { baseRevisionId: head.revision.id, ops, summary: "Caps Word key" });
};

describe("layout settings", () => {
  test("with nothing stored, each option shows its default as the value, unstored and unforced", async () => {
    const { dataDir } = await world();
    const settings = await rows(dataDir, "my-moonlander");
    expect(settings.TAPPING_TERM).toMatchObject({ name: "Tapping term", value: 200, default: 200, stored: false, forced_by: null, source_text: null });
    expect(settings.COMBO_TERM).toMatchObject({ value: 50, default: 50, stored: false });
    expect(Object.keys(settings)).not.toContain("CONFIG_ZMK_POINTING");
  });

  test("a stored value is the value in force, the default stays the default, and the option is marked stored", async () => {
    const { app, dataDir, layoutId } = await world();
    const head = getLayout(app, layoutId);
    applyOps(app, layoutId, {
      baseRevisionId: head.revision.id, summary: "Tapping term",
      ops: [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "TAPPING_TERM", value: 170 } }],
    });
    const settings = await rows(dataDir, "my-moonlander");
    expect(settings.TAPPING_TERM).toMatchObject({ value: 170, default: 200, stored: true, forced_by: null });
    expect(settings.COMBO_TERM).toMatchObject({ stored: false });
    // --rev reads an older revision: before the change the default was in force.
    expect((await rows(dataDir, "my-moonlander", ["--rev", head.revision.id])).TAPPING_TERM).toMatchObject({ value: 200, stored: false });
  });

  test("a stored expression has no known value: null in JSON, expression in the table, the text kept", async () => {
    const { app, dataDir, layoutId } = await world();
    const head = getLayout(app, layoutId);
    applyOps(app, layoutId, {
      baseRevisionId: head.revision.id, summary: "Tapping term as an expression",
      ops: [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "TAPPING_TERM", value: "(TAPPING_TERM + 10)" } }],
    });
    const settings = await rows(dataDir, "my-moonlander");
    expect(settings.TAPPING_TERM).toMatchObject({ value: null, default: 200, stored: true, source_text: "(TAPPING_TERM + 10)" });
    const line = (await cli(["--format", "table", "layout", "settings", "my-moonlander"], dataDir)).out.split("\n").find((l) => l.startsWith("TAPPING_TERM"));
    expect(line).toMatch(/^TAPPING_TERM\s+Tapping term\s+expression\s+200 ms\s+stored\s+source: \(TAPPING_TERM \+ 10\)$/);
  });

  test("a Caps Word key forces Caps Word on, says why, and wins over a stored off", async () => {
    const { app, dataDir, layoutId } = await world();
    putCapsWord(app, layoutId);
    const head = getLayout(app, layoutId);
    applyOps(app, layoutId, {
      baseRevisionId: head.revision.id, summary: "Caps Word off",
      ops: [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "CAPS_WORD_ENABLE", value: false } }],
    });
    const settings = await rows(dataDir, "my-moonlander");
    expect(settings.CAPS_WORD_ENABLE).toMatchObject({ value: true, default: false, stored: true });
    expect(settings.CAPS_WORD_ENABLE?.forced_by).toContain("A Caps Word key on this layout turns it on");
    expect(settings.TAPPING_TERM?.forced_by).toBeNull();
  });

  test("the table reads KEY, VALUE, DEFAULT and STORED, with the forced reason in the note", async () => {
    const { app, dataDir, layoutId } = await world();
    putCapsWord(app, layoutId);
    const r = await cli(["--format", "table", "layout", "settings", "my-moonlander"], dataDir);
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    expect(lines[0]).toMatch(/^lay_[0-9A-Z]{26}  my-moonlander  zsa\/moonlander  rev_/);
    expect(lines.find((l) => l.startsWith("KEY"))).toMatch(/^KEY\s+NAME\s+VALUE\s+DEFAULT\s+STORED\s+NOTE$/);
    expect(lines.find((l) => l.startsWith("TAPPING_TERM"))).toMatch(/^TAPPING_TERM\s+Tapping term\s+200 ms\s+200 ms\s+-\s*$/);
    expect(lines.find((l) => l.startsWith("CAPS_WORD_ENABLE"))).toMatch(/Caps Word\s+on\s+off\s+-\s+forced: A Caps Word key on this layout/);
    expect(lines.find((l) => l.startsWith("ONESHOT_TIMEOUT"))).toMatch(/Never\s+Never/);
    expect(r.out).toContain("setFirmwareSetting");
  });

  test("the JSON shape carries the layout and one object per option; jsonl is one line per option; ids are the keys", async () => {
    const { dataDir } = await world();
    const json = JSON.parse((await cli(["--format", "json", "layout", "settings", "my-moonlander"], dataDir)).out);
    expect(Object.keys(json)).toEqual(["schema_version", "layout_id", "name", "board_id", "revision_id", "settings"]);
    expect(json).toMatchObject({ schema_version: 1, name: "my-moonlander", board_id: "zsa/moonlander" });
    expect(Object.keys(json.settings[0])).toEqual(["key", "name", "group", "kind", "unit", "value", "default", "stored", "source_text", "forced_by"]);
    expect(json.settings[0]).toMatchObject({ key: "TAPPING_TERM", group: "Typing feel", kind: "number", unit: "ms" });

    const lines = (await cli(["--format", "jsonl", "layout", "settings", "my-moonlander"], dataDir)).out.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(json.settings.length);
    expect(lines[0]).toMatchObject({ schema_version: 1, layout_id: json.layout_id, key: "TAPPING_TERM" });
    expect((await cli(["--format", "ids", "layout", "settings", "my-moonlander"], dataDir)).out.split("\n")[0]).toBe("TAPPING_TERM");
  });

  test("an unknown layout is a not-found error and --help says it changes nothing", async () => {
    const { dataDir } = await world();
    const missing = await cli(["layout", "settings", "nope"], dataDir);
    expect(missing.code).not.toBe(0);
    expect(JSON.parse(missing.err).error).toMatchObject({ code: "not_found", message: expect.stringContaining("no layout") });
    const help = await cli(["layout", "settings", "--help"], dataDir);
    expect(help.out).toMatch(/Read\s+only/);
    expect(help.out).toContain("setFirmwareSetting");
  });
});
