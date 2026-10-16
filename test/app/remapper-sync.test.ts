// The MacBook's sync states and flows against a fake kanata (21): in sync, behind, not connected, not keyloom's, remapping off,
// the first-proof gate for auto-apply, and the apply timing the promise is about ("an Apply changes it in under a second").
import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { UsageError, applyOps } from "../../src/app/index.ts";
import { findLayoutRow } from "../../src/persistence/layouts.ts";
import { lastSyncOfBoard } from "../../src/persistence/syncs.ts";
import { macbook, at } from "../helpers/macbook.ts";
import { MAC, remapperWorld } from "../helpers/remapper-world.ts";
import { waitFor } from "../helpers/fake-sync.ts";

// waitFor can run up to 15 s on a slow runner (fake-sync.ts); bun's 5 s default would cut it off first.
setDefaultTimeout(20_000);

let editNo = 0;
let w: ReturnType<typeof remapperWorld> | undefined;
afterEach(async () => {
  await w?.stopAll();
  w = undefined;
});
const make = (o: Parameters<typeof remapperWorld>[0] = {}) => ((editNo = 0), (w = remapperWorld(o)));
const kind = (e: ReturnType<ReturnType<typeof remapperWorld>["engine"]>) => e.views().find((v) => v.boardId === MAC)?.state;

/** Puts the next F-key on Caps Lock through the editor's own path (dropping what was there, as an editor change must say). */
function edit(world: ReturnType<typeof remapperWorld>) {
  const head = findLayoutRow(world.app.db, world.layoutId)!.headRevisionId;
  const was = editNo === 0 ? "CAPS_LOCK" : `F${12 + editNo}`;
  const code = `F${13 + editNo++}`;
  return applyOps(world.app, world.layoutId, {
    baseRevisionId: head, summary: `Caps Lock: ${code}`,
    ops: [{ op: "dropFunction", function: `key:${was}`, reason: "test edit" }, { op: "setBinding", at: { layerId: "base", position: at("CAPS_LOCK") }, binding: { kind: "key", code } }],
  });
}

describe("the MacBook's sync state", () => {
  test("a daemon running keyloom's setup file is behind, and Sync now puts the head on it in well under a second", async () => {
    const world = make();
    const e = world.engine();
    await e.start();
    expect(kind(e)).toMatchObject({ kind: "behind", changes: null });
    const r = await e.syncNow(world.layoutId);
    expect(r.kind).toBe("started");
    if (r.kind !== "started") return;
    const done = await r.done;
    expect(done.status).toBe("succeeded");
    expect(kind(e)).toEqual({ kind: "in_sync" });
    const last = lastSyncOfBoard(world.app.db, MAC)!;
    expect((last.finishedAt ?? 0) - last.appliedAt).toBeLessThan(1000);
    expect(readFileSync(world.paths.kbd, "utf8")).toContain(`keyloom-${findLayoutRow(world.app.db, world.layoutId)!.headRevisionId}`);
  });

  test("an edit makes it behind by one change, and the next sync catches up", async () => {
    const world = make();
    const e = world.engine();
    await e.start();
    const first = await e.syncNow(world.layoutId);
    if (first.kind === "started") await first.done;
    edit(world);
    expect(kind(e)).toMatchObject({ kind: "behind", changes: 1 });
    const again = await e.syncNow(world.layoutId);
    if (again.kind === "started") await again.done;
    expect(kind(e)).toEqual({ kind: "in_sync" });
    expect(readFileSync(world.paths.kbd, "utf8")).toContain("(deflayer base");
  });

  test("kanata not running is not connected, and Sync now says what is missing instead of 'plug it in'", async () => {
    const world = make();
    world.fake.stop();
    const e = world.engine();
    await e.start();
    expect(kind(e)).toEqual({ kind: "not_connected" });
    await expect(e.syncNow(world.layoutId)).rejects.toThrow(/kanata isn't running/);
  });

  test("a config keyloom didn't write is 'not keyloom's' and is never replaced by Sync now", async () => {
    const world = make();
    writeFileSync(world.paths.kbd, "(defsrc a)\n(deflayer base a)\n");
    // Point the fake at a foreign file by reloading it.
    const { reloadFile } = await import("../../src/firmware/kanata/client.ts");
    await reloadFile({ port: world.fake.port }, world.paths.kbd);
    const e = world.engine();
    await e.start();
    expect(kind(e)).toMatchObject({ kind: "not_keyloom" });
    await expect(e.syncNow(world.layoutId)).rejects.toThrow(UsageError);
  });

  test("Disable remapping loads the identity map; auto-apply doesn't undo it, Sync now does", async () => {
    const world = make({ proven: true });
    const e = world.engine({ quietMs: 5 });
    await e.start();
    const first = await e.syncNow(world.layoutId);
    if (first.kind === "started") await first.done;
    await e.disableRemapping(MAC);
    expect(kind(e)).toMatchObject({ kind: "behind", why: "remapping_off" });
    edit(world);
    await Bun.sleep(30);
    await e.tick();
    // Auto-apply stays out of it: BK switched remapping off deliberately.
    expect(world.fake.running()).toBe(world.paths.safe);
    const back = await e.syncNow(world.layoutId);
    if (back.kind === "started") await back.done;
    expect(kind(e)).toEqual({ kind: "in_sync" });
    expect(world.fake.running()).toBe(world.paths.kbd);
  });
});

describe("auto-apply", () => {
  test("cannot turn on until the exit chord has been proved", async () => {
    const world = make();
    const e = world.engine();
    expect(() => e.setAutoSync(MAC, true)).toThrow(/emergency exit/);
  });

  test("once proved, an edit is applied by itself after the quiet time", async () => {
    const world = make({ proven: true });
    const e = world.engine({ quietMs: 5, tickMs: 20 });
    await e.start();
    const first = await e.syncNow(world.layoutId);
    if (first.kind === "started") await first.done;
    edit(world);
    await waitFor(() => kind(e)?.kind === "in_sync", "auto-apply", 4000);
    expect(lastSyncOfBoard(world.app.db, MAC)!.trigger).toBe("auto");
  });

  test("a layout kanata refuses (no Escape) is refused at Apply and the keyboard keeps the old file", async () => {
    const world = make();
    const e = world.engine();
    await e.start();
    const first = await e.syncNow(world.layoutId);
    if (first.kind === "started") await first.done;
    const before = readFileSync(world.paths.kbd, "utf8");
    // The validator is the gate for edits; here the generator's own refusal is exercised through a tap dance with a hold slot.
    const { createLayout } = await import("../../src/persistence/layouts.ts");
    const { identityLayout } = await import("../../src/firmware/kanata/identity.ts");
    const bad = { ...identityLayout(macbook()), tapDances: [{ id: "t", name: "T", tap: { kind: "key" as const, code: "TAB" as const }, hold: { kind: "key" as const, code: "ESCAPE" as const } }] };
    bad.layers[0]!.bindings[at("TAB")] = { kind: "tapDance", tapDanceId: "t" };
    const created = createLayout(world.app.db, { name: "bad", layout: bad, summary: "bad", origin: "import" });
    const r = await e.syncNow(created.layout.id).catch((err) => err);
    if (!(r instanceof Error) && r.kind === "started") {
      const done = await r.done;
      expect(done.status).toBe("failed");
    }
    expect(readFileSync(world.paths.kbd, "utf8")).toBe(before);
  });
});
