// The MacBook's sync states and flows against a fake kanata (21): in sync, behind, not connected, not keyloom's, remapping off,
// the first-proof gate for auto-apply, and the apply timing the promise is about ("an Apply changes it in under a second").
import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError, applyOps, applyToRemapper } from "../../src/app/index.ts";
import { findLayoutRow } from "../../src/persistence/layouts.ts";
import { getBoardConfig } from "../../src/persistence/configs.ts";
import { newConfig } from "../../src/app/configs.ts";
import { SyncRefusal } from "../../src/app/sync-engine.ts";
import { activeSyncs, claimSync, getBoardSync, newSyncId } from "../../src/persistence/syncs.ts";
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

  test("remap apply verifies the head and clears a failed kanata sync", async () => {
    const world = make({ proven: true });
    const apply = world.deps.remapper!.apply;
    world.deps.remapper!.apply = async () => ({ ok: false, step: "reload", error: "injected reload failure" });
    const e = world.engine();
    await e.start();
    const run = await e.syncNow(world.layoutId);
    expect(run.kind).toBe("started");
    if (run.kind !== "started") throw new Error("sync did not start");
    expect((await run.done).status).toBe("failed");
    expect(kind(e)).toMatchObject({ kind: "behind", why: "failed" });
    world.deps.remapper!.apply = apply;
    const recovered = await applyToRemapper(world.app, world.layoutId, undefined, world.over);
    expect(recovered.ok).toBe(true);
    await e.tick();
    expect(kind(e)).toEqual({ kind: "in_sync" });
    expect(lastSyncOfBoard(world.app.db, MAC)?.status).toBe("failed");
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
    // The code is what the page acts on (R1-16), so it never has to read that sentence.
    await expect(e.syncNow(world.layoutId)).rejects.toMatchObject({ code: "kanata_not_running" });
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
    await expect(e.syncNow(world.layoutId)).rejects.toBeInstanceOf(SyncRefusal);
  });

  test("Replace it puts the head on over a foreign config and keeps the old file beside it (R1-17)", async () => {
    const world = make();
    const foreign = "(defsrc a)\n(deflayer base a)\n";
    writeFileSync(world.paths.kbd, foreign);
    const { reloadFile } = await import("../../src/firmware/kanata/client.ts");
    await reloadFile({ port: world.fake.port }, world.paths.kbd);
    const e = world.engine();
    await e.start();
    expect(kind(e)).toMatchObject({ kind: "not_keyloom" });
    await e.replaceForeignRemapperConfig(world.layoutId);
    expect(readFileSync(`${world.paths.kbd}.before-keyloom`, "utf8")).toBe(foreign);
    expect(readFileSync(world.paths.kbd, "utf8")).toContain(`keyloom-${findLayoutRow(world.app.db, world.layoutId)!.headRevisionId}`);
    expect(world.fake.running()).toBe(world.paths.kbd);
    expect(kind(e)).toEqual({ kind: "in_sync" });
    // It ran as a claimed sync, so another process saw the keyboard busy while it wrote.
    expect(lastSyncOfBoard(world.app.db, MAC)).toMatchObject({ trigger: "manual", status: "succeeded" });
  });

  test("Replace it from a refused put-on makes the config put on the board's config", async () => {
    const world = make();
    const other = newConfig(world.app, { name: "Travel", from: "config", config: world.layoutId }).id;
    writeFileSync(world.paths.kbd, "(defsrc a)\n(deflayer base a)\n");
    const { reloadFile } = await import("../../src/firmware/kanata/client.ts");
    await reloadFile({ port: world.fake.port }, world.paths.kbd);
    const e = world.engine();
    await e.start();
    expect(getBoardConfig(world.app.db, MAC)).not.toBe(other);
    await e.replaceForeignRemapperConfig(other);
    expect(getBoardConfig(world.app.db, MAC)).toBe(other);
    expect(e.views().find((v) => v.boardId === MAC)).toMatchObject({ layoutId: other, state: { kind: "in_sync" } });
  });

  test("Replace it after remapping was switched off is a stale confirm: refused, and remapping stays off", async () => {
    const world = make();
    const e = world.engine();
    await e.start();
    // The confirm opened over a foreign config; then something loaded safe.kbd before the person pressed Replace it.
    await e.disableRemapping(MAC);
    const before = readFileSync(world.paths.kbd, "utf8");
    await expect(e.replaceForeignRemapperConfig(world.layoutId)).rejects.toMatchObject({ code: "kanata_not_foreign" });
    expect(world.fake.running()).toBe(world.paths.safe);
    expect(readFileSync(world.paths.kbd, "utf8")).toBe(before);
  });

  test("a keyloom.kbd edited on disk while kanata runs keyloom's config fails as foreign_file, and Replace it gets past it (R4 residual 2)", async () => {
    const world = make();
    const e = world.engine();
    await e.start();
    const foreign = "(defsrc a)\n(deflayer base a)\n";
    // kanata still runs keyloom's setup file; only the file on disk changed.
    writeFileSync(world.paths.kbd, foreign);
    const r = await e.syncNow(world.layoutId);
    if (r.kind !== "started") throw new Error("sync did not start");
    expect(await r.done).toMatchObject({ status: "failed", failure: "foreign_file" });
    expect(kind(e)).toMatchObject({ kind: "behind", why: "failed" });
    expect(readFileSync(world.paths.kbd, "utf8")).toBe(foreign);
    await e.replaceForeignRemapperConfig(world.layoutId);
    expect(readFileSync(`${world.paths.kbd}.before-keyloom`, "utf8")).toBe(foreign);
    expect(world.fake.running()).toBe(world.paths.kbd);
    expect(kind(e)).toEqual({ kind: "in_sync" });
  });

  test("Turn remapping on refused by a foreign keyloom.kbd can be replaced while remapping is off (R4 residual 2)", async () => {
    const world = make();
    const e = world.engine();
    await e.start();
    await e.disableRemapping(MAC);
    const foreign = "(defsrc a)\n(deflayer base a)\n";
    writeFileSync(world.paths.kbd, foreign);
    const r = await e.syncNow(world.layoutId);
    if (r.kind !== "started") throw new Error("sync did not start");
    expect(await r.done).toMatchObject({ status: "failed", failure: "foreign_file" });
    expect(world.fake.running()).toBe(world.paths.safe);
    await e.replaceForeignRemapperConfig(world.layoutId);
    expect(readFileSync(`${world.paths.kbd}.before-keyloom`, "utf8")).toBe(foreign);
    expect(kind(e)).toEqual({ kind: "in_sync" });
  });

  test("Disable remapping after a foreign_file failure makes Replace it stale, so it can't turn remapping back on (#290 review)", async () => {
    const world = make();
    const e = world.engine();
    await e.start();
    writeFileSync(world.paths.kbd, "(defsrc a)\n(deflayer base a)\n");
    const r = await e.syncNow(world.layoutId);
    if (r.kind !== "started") throw new Error("sync did not start");
    await r.done;
    expect(e.views().find((v) => v.boardId === MAC)?.last?.errorCode).toBe("foreign_file");
    await e.disableRemapping(MAC);
    expect(e.views().find((v) => v.boardId === MAC)?.last?.errorCode).toBeNull();
    await expect(e.replaceForeignRemapperConfig(world.layoutId)).rejects.toMatchObject({ code: "kanata_not_foreign" });
    expect(world.fake.running()).toBe(world.paths.safe);
  });

  test("Replace it while another keyloom process holds the sync claim is busy and writes nothing", async () => {
    const world = make();
    const foreign = "(defsrc a)\n(deflayer base a)\n";
    writeFileSync(world.paths.kbd, foreign);
    const { reloadFile } = await import("../../src/firmware/kanata/client.ts");
    await reloadFile({ port: world.fake.port }, world.paths.kbd);
    const OTHER = 999_999;
    const e = world.engine({ alive: (pid) => pid === OTHER || pid === process.pid });
    await e.start();
    claimSync(world.app.db, {
      id: newSyncId(), boardId: MAC, layoutId: world.layoutId, revisionId: findLayoutRow(world.app.db, world.layoutId)!.headRevisionId, boardRevision: "",
      trigger: "auto", logPath: "logs/other.log", appliedAt: 0, owner: "other", pid: OTHER,
    }, () => true);
    await expect(e.replaceForeignRemapperConfig(world.layoutId)).rejects.toMatchObject({ code: "busy" });
    expect(readFileSync(world.paths.kbd, "utf8")).toBe(foreign);
  });

  test("Replace it whose log can't be opened finishes its claim, so the next sync isn't busy", async () => {
    const world = make();
    const { reloadFile } = await import("../../src/firmware/kanata/client.ts");
    writeFileSync(world.paths.kbd, "(defsrc a)\n(deflayer base a)\n");
    await reloadFile({ port: world.fake.port }, world.paths.kbd);
    const e = world.engine();
    await e.start();
    // A file where the logs folder should be: opening the sync's log throws after the claim is taken.
    rmSync(join(world.app.dataDir, "logs"), { recursive: true, force: true });
    writeFileSync(join(world.app.dataDir, "logs"), "");
    await expect(e.replaceForeignRemapperConfig(world.layoutId)).rejects.toThrow();
    expect(activeSyncs(world.app.db)).toEqual([]);
    expect(lastSyncOfBoard(world.app.db, MAC)).toMatchObject({ status: "failed", failure: "flash" });
    rmSync(join(world.app.dataDir, "logs"));
    await e.replaceForeignRemapperConfig(world.layoutId);
    expect(lastSyncOfBoard(world.app.db, MAC)).toMatchObject({ status: "succeeded" });
  });

  test("stopping the engine during Replace it waits for the apply and its recorded result", async () => {
    const world = make();
    const { reloadFile } = await import("../../src/firmware/kanata/client.ts");
    writeFileSync(world.paths.kbd, "(defsrc a)\n(deflayer base a)\n");
    await reloadFile({ port: world.fake.port }, world.paths.kbd);
    const real = world.deps.remapper!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let applying = false;
    world.deps.remapper = { ...real, apply: async (input) => ((applying = true), await gate, real.apply(input)) };
    const e = world.engine();
    await e.start();
    const replaced = e.replaceForeignRemapperConfig(world.layoutId);
    await waitFor(() => applying, "the apply to start", 4000);
    let stopped = false;
    const stopping = e.stop().then(() => (stopped = true));
    await Bun.sleep(30);
    expect(stopped).toBe(false);
    release();
    await stopping;
    // Recorded before stop() returned, so a database closed after it would lose nothing.
    expect(lastSyncOfBoard(world.app.db, MAC)).toMatchObject({ status: "succeeded" });
    await replaced;
  });

  test("Replace it with kanata stopped says so and writes nothing", async () => {
    const world = make();
    const before = readFileSync(world.paths.kbd, "utf8");
    world.fake.stop();
    const e = world.engine();
    await e.start();
    await expect(e.replaceForeignRemapperConfig(world.layoutId)).rejects.toMatchObject({ code: "kanata_not_running" });
    expect(readFileSync(world.paths.kbd, "utf8")).toBe(before);
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

  test("the exit-chord button is refused while kanata answers, and recorded once it has stopped (R1-18)", async () => {
    const world = make();
    const e = world.engine();
    await e.start();
    await expect(e.confirmExitChord(MAC)).rejects.toMatchObject({ code: "kanata_still_running" });
    expect(getBoardSync(world.app.db, MAC).provenAt).toBeNull();
    world.fake.stop();
    await e.confirmExitChord(MAC);
    expect(getBoardSync(world.app.db, MAC).provenAt).not.toBeNull();
    expect(e.views().find((v) => v.boardId === MAC)?.auto.proven).toBe(true);
  });

  test("the exit chord is probed after the keyboards are read, and a fresh reading of kanata running records nothing", async () => {
    const world = make();
    const real = world.deps.remapper!;
    const order: string[] = [];
    const read = world.deps.readKeyboards;
    world.deps.readKeyboards = async () => (order.push("read"), read());
    // A probe that says stopped while kanata still answers the read: the read is newer evidence and wins.
    world.deps.remapper = { ...real, probe: async () => (order.push("probe"), "stopped") };
    const e = world.engine();
    await e.start();
    await expect(e.confirmExitChord(MAC)).rejects.toMatchObject({ code: "kanata_still_running" });
    expect(getBoardSync(world.app.db, MAC).provenAt).toBeNull();
    world.fake.stop();
    order.length = 0;
    await e.confirmExitChord(MAC);
    // The tick after the proof reads again; the confirm itself read, then probed.
    expect(order.slice(0, 2)).toEqual(["read", "probe"]);
    expect(getBoardSync(world.app.db, MAC).provenAt).not.toBeNull();
  });

  test("a kanata keyloom never saw running proves nothing, and the button waits for it (R3-00, D-509)", async () => {
    const world = make();
    // A fresh setup: kanata never started, so its port refuses exactly as it would after the chord.
    world.fake.stop();
    const e = world.engine();
    await e.start();
    expect(e.views().find((v) => v.boardId === MAC)?.auto.exitChordReady).toBe(false);
    await expect(e.confirmExitChord(MAC)).rejects.toMatchObject({ code: "kanata_not_seen" });
    expect(getBoardSync(world.app.db, MAC).provenAt).toBeNull();
  });

  test("a stop counts only within ten minutes of keyloom seeing kanata run its config (D-509)", async () => {
    const world = make();
    let clock = 1_000_000;
    const e = world.engine({ now: () => clock });
    await e.start();
    // Seen running keyloom's setup file: the button is offered.
    expect(getBoardSync(world.app.db, MAC).kanataSeenAt).toBe(clock);
    expect(e.views().find((v) => v.boardId === MAC)?.auto.exitChordReady).toBe(true);
    world.fake.stop();
    clock += 10 * 60_000 + 1;
    await e.tick();
    expect(e.views().find((v) => v.boardId === MAC)?.auto.exitChordReady).toBe(false);
    await expect(e.confirmExitChord(MAC)).rejects.toMatchObject({ code: "kanata_not_seen" });
    expect(getBoardSync(world.app.db, MAC).provenAt).toBeNull();
  });

  test("once proven, a running kanata is no longer written down every poll", async () => {
    const world = make({ proven: true });
    const e = world.engine();
    await e.start();
    expect(getBoardSync(world.app.db, MAC).kanataSeenAt).toBeNull();
    expect(e.views().find((v) => v.boardId === MAC)?.auto.exitChordReady).toBe(false);
  });

  test("a port that neither answers nor refuses records no proof, and says to check again (D-497)", async () => {
    const world = make();
    const e = world.engine();
    await e.start();
    world.fake.stop();
    // Something holds kanata's port open and never answers: kanata may still be running behind it.
    const silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    world.over.endpoint.port = silent.port;
    try {
      await expect(e.confirmExitChord(MAC)).rejects.toMatchObject({ code: "kanata_unreadable" });
      expect(getBoardSync(world.app.db, MAC).provenAt).toBeNull();
    } finally {
      silent.stop(true);
    }
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
    // The validator is the gate for edits; here the generator's own refusal is exercised through a binding that runs a command as root.
    const { createLayout } = await import("../../src/persistence/layouts.ts");
    const { identityLayout } = await import("../../src/firmware/kanata/identity.ts");
    const bad = identityLayout(macbook());
    bad.layers[0]!.bindings[at("TAB")] = { kind: "native", firmware: "kanata", source: "(cmd rm -rf /)", label: "x" };
    const created = createLayout(world.app.db, { name: "bad", layout: bad, summary: "bad", origin: "import" });
    const r = await e.syncNow(created.layout.id).catch((err) => err);
    if (!(r instanceof Error) && r.kind === "started") {
      const done = await r.done;
      expect(done.status).toBe("failed");
    }
    expect(readFileSync(world.paths.kbd, "utf8")).toBe(before);
  });
});
