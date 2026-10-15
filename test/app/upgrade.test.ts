import { describe, expect, test } from "bun:test";
import { closeApp, getLayout, listRevisions, openApp, undo, upgradeLayout, upgradeOffer } from "../../src/app/index.ts";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { upgradeStoredOryx } from "../../src/firmware/qmk/upgrade.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { moonlander } from "../helpers/board.ts";
import { modernAndLegacy } from "../helpers/legacy-oryx.ts";
import { tempDir } from "../helpers/tmp.ts";

const board = await moonlander();
const { modern, legacy } = await modernAndLegacy(board.definition);

function stored(layout: Layout) {
  const dir = tempDir();
  const app = openApp({ dataDir: dir });
  const made = createLayout(app.db, { name: "bk", layout, summary: "Imported", origin: "import" });
  return { app, dir, id: made.layout.id };
}
const documentOf = (app: ReturnType<typeof openApp>, revisionId: string) => (app.db.query("SELECT document FROM revisions WHERE id = ?").get(revisionId) as { document: string }).document;
const count = (app: ReturnType<typeof openApp>) => (app.db.query("SELECT COUNT(*) AS n FROM revisions").get() as { n: number }).n;

describe("the layout as v0.12 stored it", () => {
  test("holds Oryx's code that today's importers model", () => {
    expect(legacy.tapDances).toEqual([]);
    expect(legacy.layers.every((l) => l.lighting === undefined)).toBe(true);
    expect(legacy.layers.some((l) => l.bindings.some((b) => b.kind === "native" && b.source.startsWith("TD(")))).toBe(true);
  });

  test("reading it never writes: the head, the revision count and the stored text stay as they were", () => {
    const { app, id } = stored(legacy);
    const before = { revisions: count(app), head: getLayout(app, id).revision.id, text: documentOf(app, getLayout(app, id).revision.id) };
    for (let i = 0; i < 3; i++) getLayout(app, id);
    upgradeOffer(getLayout(app, id));
    expect({ revisions: count(app), head: getLayout(app, id).revision.id, text: documentOf(app, before.head) }).toEqual(before);
    closeApp(app);
  });

  test("the offer names what applies: colours and tap dances here, one of them when only one is left", () => {
    const { app, id } = stored(legacy);
    expect(upgradeOffer(getLayout(app, id))).toEqual({ colours: true, tapDances: true });
    closeApp(app);
    expect(upgradeStoredOryx({ ...legacy, passthrough: legacy.passthrough.filter((p) => p.anchor !== "tap-dance" && p.anchor !== "tap-dance-codes") }, board.definition)).toMatchObject({ colours: true, tapDances: false });
    expect(upgradeStoredOryx(modern, board.definition)).toBeNull();
  });
});

describe("the upgrade", () => {
  test("is one revision named for what it read, and the layout then edits like a fresh import", () => {
    const { app, id } = stored(legacy);
    const out = upgradeLayout(app, id);
    expect(out.changed).toBe(true);
    expect(count(app)).toBe(2);
    const view = getLayout(app, id);
    expect(view.revision.summary).toBe("Read colours and tap dances from the Oryx code");
    expect(view.document.tapDances).toEqual(modern.tapDances);
    expect(view.document.layers.map((l) => l.lighting)).toEqual(modern.layers.map((l) => l.lighting));
    expect(view.document.layers.map((l) => l.bindings)).toEqual(modern.layers.map((l) => l.bindings));
    expect(upgradeOffer(view)).toBeNull();
    closeApp(app);
  });

  test("undo puts the old document back byte for byte", () => {
    const { app, id } = stored(legacy);
    const first = getLayout(app, id).revision.id;
    const original = documentOf(app, first);
    upgradeLayout(app, id);
    undo(app, id);
    expect(documentOf(app, getLayout(app, id).revision.id)).toBe(original);
    expect(listRevisions(app, id).length).toBe(3);
    closeApp(app);
  });

  test("on a layout that is already modelled it writes nothing and says so", () => {
    const { app, id } = stored(modern);
    const out = upgradeLayout(app, id);
    expect(out.changed).toBe(false);
    expect(out.message).toContain("nothing was changed");
    expect(count(app)).toBe(1);
    closeApp(app);
    const again = stored(legacy);
    upgradeLayout(again.app, again.id);
    expect(upgradeLayout(again.app, again.id).changed).toBe(false);
    expect(count(again.app)).toBe(2);
    closeApp(again.app);
  });

  test("names only the part that applies in the revision", () => {
    // Colours only: the tap dances are already modelled, the colours are still code.
    const coloursLeft: Layout = { ...modern, layers: modern.layers.map(({ lighting: _l, ...l }) => l), passthrough: legacy.passthrough.filter((p) => !p.anchor.startsWith("tap-dance")) };
    const { app, id } = stored(coloursLeft);
    expect(upgradeLayout(app, id)).toMatchObject({ changed: true, message: "Read colours from the Oryx code." });
    closeApp(app);
    // Tap dances only: the colours are already modelled, the dances are still code.
    const tapsLeft: Layout = { ...legacy, layers: legacy.layers.map((l, i) => ({ ...l, ...(modern.layers[i]?.lighting === undefined ? {} : { lighting: modern.layers[i]?.lighting }) })), passthrough: [...modern.passthrough, ...legacy.passthrough.filter((p) => p.anchor.startsWith("tap-dance"))] };
    const two = stored(tapsLeft);
    expect(upgradeLayout(two.app, two.id)).toMatchObject({ changed: true, message: "Read tap dances from the Oryx code." });
    closeApp(two.app);
  });

  test("a keyloom-made tap dance beside kept Oryx dance code is left alone", () => {
    const withOwn: Layout = { ...legacy, tapDances: [modern.tapDances[0] as NonNullable<Layout["tapDances"]>[number]] };
    expect(upgradeStoredOryx(withOwn, board.definition)?.tapDances).toBe(false);
  });
});

describe("keyloom layout upgrade", () => {
  async function cli(args: string[]) {
    let out = "";
    let err = "";
    const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
    const code = await runCli(args, io);
    return { code, out, err };
  }

  test("upgrades once, then reports there is nothing to do", async () => {
    const { app, dir, id } = stored(legacy);
    closeApp(app);
    const first = await cli(["layout", "upgrade", id, "--data-dir", dir]);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.out)).toMatchObject({ changed: true });
    const second = await cli(["layout", "upgrade", id, "--data-dir", dir]);
    expect(second.code).toBe(0);
    expect(JSON.parse(second.out)).toMatchObject({ changed: false, revision_id: null });
  });
});
