// The state of a keyboard against its head as a pure function (17#apply-sync-and-the-keyboards-state): every row of the
// blueprint's table, and the conditions that must not be ignored (a check reading `not` the wrong way round shows here).
import { describe, expect, test } from "bun:test";
import { type SyncFacts, autoSyncDue, deriveState } from "../../src/app/sync-state.ts";
import type { KeyboardReading } from "../../src/app/sync-keyboard.ts";
import type { SyncRow } from "../../src/persistence/syncs.ts";

const keyloom: KeyboardReading = { state: "keyloom", keys: ["AAAAAAAAAAAA"], boardRevision: "reva" };
const base = (over: Partial<SyncFacts> = {}): SyncFacts => ({
  reading: keyloom, running: { kind: "behind", changes: 2 }, active: undefined, headSync: undefined,
  auto: { on: true, paused: false, proven: true }, quiet: true, ...over,
});
const row = (over: Partial<SyncRow> = {}): SyncRow => ({
  id: "syn_1", boardId: "zsa/moonlander", layoutId: "lay_1", revisionId: "rev_1", boardRevision: "reva", trigger: "auto", status: "building", step: "building",
  instruction: null, failure: null, error: null, buildId: null, flashId: null, logPath: "logs/x", pid: 1, owner: "o", appliedAt: 0, startedAt: 0, builtAt: null,
  flashStartedAt: null, finishedAt: null, ...over,
});

describe("deriveState", () => {
  test.each([{ state: "absent" }, { state: "other", detail: "unknown firmware" }] as const)("a failed split flash keeps its error when no verified halves remain: %s", (reading) => {
    const latestSync = row({ status: "failed", failure: "flash", error: "Rollback is incomplete: the left half is absent" });
    expect(deriveState(base({ split: true, reading, latestSync }))).toEqual({ kind: "needs_hand", instruction: latestSync.error!, reason: "" });
  });

  test("a split recovery failure stays visible across a later edit", () => {
    expect(deriveState(base({ split: true, latestSync: row({ status: "failed", failure: "flash", error: "Rollback failed" }), running: { kind: "same" } })))
      .toMatchObject({ kind: "behind", why: "failed", error: "Rollback failed" });
  });
  test("a failed flash of the head wins over the visible half reporting the head", () => {
    expect(deriveState(base({ running: { kind: "same" }, headSync: row({ status: "failed", failure: "flash", error: "the left half is absent" }) })))
      .toMatchObject({ kind: "behind", why: "failed", error: "the left half is absent" });
  });
  test("in sync, when the keyboard runs the head", () => {
    expect(deriveState(base({ running: { kind: "same" } }))).toEqual({ kind: "in_sync" });
  });

  test("syncing, with the step, for each step of a running sync", () => {
    for (const step of ["building", "restarting", "writing", "verifying"] as const) {
      expect(deriveState(base({ active: row({ step }) }))).toMatchObject({ kind: "syncing", step, syncId: "syn_1" });
    }
  });

  test("a running sync wins over everything the keyboard reads as, because it is what is happening", () => {
    for (const reading of [{ state: "absent" }, { state: "bootloader" }, { state: "other", detail: "x" }] as const) {
      expect(deriveState(base({ reading, active: row({ status: "flashing", step: "writing" }) })).kind).toBe("syncing");
    }
  });

  test("needs a hand, with the instruction, while a flash waits for one", () => {
    expect(deriveState(base({ active: row({ status: "flashing", step: "needs_hand", instruction: "Press reset" }) }))).toMatchObject({ kind: "needs_hand", instruction: "Press reset" });
  });

  test("needs a hand after a flash gave up waiting for one, with the same words, until something changes", () => {
    const headSync = row({ status: "failed", failure: "needs_hand", instruction: "Press reset", error: "no bootloader" });
    expect(deriveState(base({ headSync }))).toMatchObject({ kind: "needs_hand", instruction: "Press reset" });
  });

  test("not connected, not keyloom's and bootloader come from the reading", () => {
    expect(deriveState(base({ reading: { state: "absent" } }))).toEqual({ kind: "not_connected" });
    // Unplugged after an apply: the count since the last build keyloom put on it travels with the state; nothing waiting says nothing.
    expect(deriveState(base({ reading: { state: "absent" }, lastKnown: { changes: 1 } }))).toEqual({ kind: "not_connected", changes: 1 });
    expect(deriveState(base({ reading: { state: "absent" }, lastKnown: { changes: 0 } }))).toEqual({ kind: "not_connected" });
    expect(deriveState(base({ reading: { state: "other", detail: "serial QxK" } }))).toEqual({ kind: "not_keyloom", detail: "serial QxK" });
    expect(deriveState(base({ reading: { state: "bootloader" } })).kind).toBe("needs_hand");
  });

  test("behind says how many changes and why nothing is happening", () => {
    expect(deriveState(base())).toMatchObject({ kind: "behind", changes: 2, why: "waiting" });
    expect(deriveState(base({ auto: { on: true, paused: true, proven: true } }))).toMatchObject({ why: "paused" });
    expect(deriveState(base({ auto: { on: false, paused: false, proven: true } }))).toMatchObject({ why: "auto_off" });
    expect(deriveState(base({ auto: { on: false, paused: false, proven: false } }))).toMatchObject({ why: "unproven" });
    expect(deriveState(base({ running: { kind: "unknown" } }))).toMatchObject({ why: "unknown_build", changes: null });
  });

  test("a failed sync of the head is behind with its error; one that the world interrupted is not", () => {
    for (const failure of ["build", "flash", "verify"] as const) {
      expect(deriveState(base({ headSync: row({ status: "failed", failure, error: "boom" }) }))).toMatchObject({ kind: "behind", why: "failed", error: "boom" });
    }
    for (const failure of ["disconnected", "interrupted", "superseded", "cancelled"] as const) {
      expect(deriveState(base({ headSync: row({ status: failure === "superseded" || failure === "cancelled" ? "cancelled" : "failed", failure, error: "x" }) }))).toMatchObject({ why: "waiting" });
    }
  });

  test("the head already put on the keyboard, and something else flashed since, is not synced by itself", () => {
    expect(deriveState(base({ headSync: row({ status: "succeeded" }) }))).toMatchObject({ kind: "behind", why: "changed_since" });
  });
});

describe("autoSyncDue", () => {
  test("is true only when every condition holds", () => {
    expect(autoSyncDue(base())).toBe(true);
  });

  test.each([
    ["auto-sync is off", { auto: { on: false, paused: false, proven: true } }],
    ["it is paused", { auto: { on: true, paused: true, proven: true } }],
    ["it was never proven", { auto: { on: true, paused: false, proven: false } }],
    ["the quiet time has not passed", { quiet: false }],
    ["the keyboard runs the head", { running: { kind: "same" } }],
    ["the keyboard runs a build this copy doesn't know", { running: { kind: "unknown" } }],
    ["the keyboard runs someone else's firmware", { reading: { state: "other", detail: "x" } }],
    ["the keyboard is not there", { reading: { state: "absent" } }],
    ["the keyboard is in its bootloader", { reading: { state: "bootloader" } }],
    ["a sync is running", { active: row() }],
    ["the head already failed to sync", { headSync: row({ status: "failed", failure: "build", error: "x" }) }],
    ["the head already needed a hand", { headSync: row({ status: "failed", failure: "needs_hand", instruction: "x" }) }],
  ] as Array<[string, Partial<SyncFacts>]>)("is false when %s", (_why, over) => {
    expect(autoSyncDue(base(over))).toBe(false);
  });

  test("is true again when the last attempt was interrupted by the world", () => {
    expect(autoSyncDue(base({ headSync: row({ status: "failed", failure: "disconnected", error: "x" }) }))).toBe(true);
  });
});

test.each([false, true])("a later successful flash of all observed halves supersedes failure (split=%s)", (split) => {
  const failed = row({ status: "failed", failure: "flash", error: "failed recovery", finishedAt: 100 });
  const facts = base({ split, running: { kind: "same" }, headSync: failed, latestSync: failed, runningFlashedAt: 101 });
  expect(deriveState(facts)).toEqual({ kind: "in_sync" });
  expect(deriveState({ ...facts, runningFlashedAt: 99 })).toMatchObject({ kind: "behind", why: "failed" });
  expect(deriveState({ ...facts, runningFlashedAt: 100 })).toMatchObject({ kind: "behind", why: "failed" });
  expect(deriveState({ ...facts, reading: { ...keyloom, missingHalves: ["left half"] } }).kind).toBe("needs_hand");
  expect(deriveState({ ...facts, running: { kind: "behind", changes: 1 }, headSync: undefined })).toMatchObject({ kind: "behind", why: "waiting" });
});
