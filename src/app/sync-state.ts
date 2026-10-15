// The state of a keyboard against its layout's head revision (17#apply-sync-and-the-keyboards-state, D-160), as a pure
// function of facts the engine collects: what the keyboard is doing, how far behind it is, and what the last sync did.
// Keeping this free of I/O is what lets the race and failure tests pin every state without a keyboard.
import type { SyncRow, SyncStep } from "../persistence/syncs.ts";
import { RETRYABLE_FAILURES, isActive } from "../persistence/syncs.ts";
import type { KeyboardReading } from "./sync-keyboard.ts";

export type SyncStepName = Exclude<SyncStep, "needs_hand" | "done">;

/** Why a keyboard that is behind is not being synced right now. */
export type BehindWhy =
  /** Auto-sync will start by itself once the quiet time has passed. */
  | "waiting"
  /** Auto-sync is off for this board, by choice. */
  | "auto_off"
  /** Auto-sync is paused. */
  | "paused"
  /** Auto-sync cannot be on yet: no flash on this board has been verified without hands. */
  | "unproven"
  /** The last sync of this revision failed; trying again would do the same thing. */
  | "failed"
  /** The keyboard runs a keyloom build this copy of keyloom has no record of, so it is not replaced by itself. */
  | "unknown_build"
  /** This revision was already put on the keyboard and something else has been flashed since. */
  | "changed_since"
  /** Remapping was switched off (safe.kbd loaded); Sync now turns it back on. */
  | "remapping_off";

export type SyncState =
  | { kind: "in_sync" }
  | { kind: "syncing"; step: SyncStepName; syncId: string; startedAt: number; trigger: "auto" | "manual" }
  | { kind: "behind"; changes: number | null; why: BehindWhy; error: string | null }
  | { kind: "needs_hand"; instruction: string; reason: string }
  | { kind: "not_connected" }
  | { kind: "not_keyloom"; detail: string };

export type SyncFacts = {
  reading: KeyboardReading;
  /** What the keyboard runs compared with the head: `same` when its builds are the head or an identical document. */
  running: { kind: "same" } | { kind: "behind"; changes: number | null } | { kind: "unknown" };
  /** The sync running now for this board, if any. */
  active: SyncRow | undefined;
  /** The newest sync of the head revision to this board, if any. */
  headSync: SyncRow | undefined;
  auto: { on: boolean; paused: boolean; proven: boolean };
  /** Whether the quiet time since the last Apply has passed, so auto-sync is due. */
  quiet: boolean;
};

const NEEDS_HAND_REASON = "keyloom couldn't restart it by itself";

export function deriveState(f: SyncFacts): SyncState {
  const a = f.active;
  if (a && isActive(a)) {
    if (a.step === "needs_hand") return { kind: "needs_hand", instruction: a.instruction ?? "", reason: NEEDS_HAND_REASON };
    return { kind: "syncing", step: a.step === "done" ? "building" : a.step, syncId: a.id, startedAt: a.startedAt, trigger: a.trigger };
  }
  if (f.reading.state === "absent") return { kind: "not_connected" };
  if (f.reading.state === "bootloader") {
    return {
      kind: "needs_hand",
      instruction: "Unplug the keyboard and plug it in again. If it still doesn't type, press Sync now.",
      reason: "it is in its bootloader, so it isn't running any firmware",
    };
  }
  if (f.reading.state === "other") return { kind: "not_keyloom", detail: f.reading.detail };
  if (f.reading.state === "remapping_off") return { kind: "behind", changes: null, why: "remapping_off", error: null };

  if (f.running.kind === "same") return { kind: "in_sync" };
  const changes = f.running.kind === "behind" ? f.running.changes : null;
  const h = f.headSync;
  if (h?.status === "failed" && h.failure === "needs_hand") {
    return { kind: "needs_hand", instruction: h.instruction ?? h.error ?? "", reason: NEEDS_HAND_REASON };
  }
  if (f.running.kind === "unknown") return { kind: "behind", changes: null, why: "unknown_build", error: null };
  if (h && h.status === "failed" && !RETRYABLE_FAILURES.includes(h.failure ?? "flash")) return { kind: "behind", changes, why: "failed", error: h.error };
  if (h?.status === "succeeded") return { kind: "behind", changes, why: "changed_since", error: null };
  if (f.auto.paused) return { kind: "behind", changes, why: "paused", error: h?.error ?? null };
  if (!f.auto.proven) return { kind: "behind", changes, why: "unproven", error: null };
  if (!f.auto.on) return { kind: "behind", changes, why: "auto_off", error: null };
  return { kind: "behind", changes, why: "waiting", error: h?.error ?? null };
}

/**
 * Whether auto-sync should start a sync now. It is the state plus the conditions that make starting safe: the keyboard
 * is running keyloom firmware this copy built (never replaced otherwise), the quiet time has passed, and this revision
 * has not already been tried to no avail.
 */
export function autoSyncDue(f: SyncFacts): boolean {
  if (f.active && isActive(f.active)) return false;
  if (f.reading.state !== "keyloom") return false;
  if (!f.auto.on || f.auto.paused || !f.auto.proven) return false;
  if (!f.quiet) return false;
  const s = deriveState(f);
  return s.kind === "behind" && s.why === "waiting";
}
