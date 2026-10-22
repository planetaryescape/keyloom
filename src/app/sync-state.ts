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
  /** The keyboard runs another config of this board. Only an explicit "put on" replaces it (D-300), so auto-sync leaves it. */
  | "other_config"
  /** This revision was already put on the keyboard and something else has been flashed since. */
  | "changed_since"
  /** Remapping was switched off (safe.kbd loaded); Sync now turns it back on. */
  | "remapping_off";

export type SyncState =
  | { kind: "in_sync" }
  | { kind: "syncing"; step: SyncStepName; syncId: string; startedAt: number; trigger: "auto" | "manual" }
  | { kind: "behind"; changes: number | null; why: BehindWhy; error: string | null }
  | { kind: "needs_hand"; instruction: string; reason: string }
  | { kind: "not_connected"; changes?: number | null }
  | { kind: "not_keyloom"; detail: string };

export type SyncFacts = {
  reading: KeyboardReading;
  /** What the keyboard runs compared with the head: `same` when its builds are the head or an identical document. */
  running: { kind: "same" } | { kind: "behind"; changes: number | null } | { kind: "unknown" } | { kind: "other_config" };
  /** The sync running now for this board, if any. */
  active: SyncRow | undefined;
  /** The newest sync of the head revision to this board, if any. */
  headSync: SyncRow | undefined;
  /** The board's latest sync also carries recovery errors across later edits. */
  latestSync?: SyncRow | undefined;
  split?: boolean;
  /** The oldest successful flash time among every currently visible half's build; absent if any half is missing or unflashed. */
  runningFlashedAt?: number;
  auto: { on: boolean; paused: boolean; proven: boolean };
  /** Whether the quiet time since the last Apply has passed, so auto-sync is due. */
  quiet: boolean;
  /**
   * For an unplugged keyboard: changes since the last revision keyloom put on it, so the sync line can say a change applied now is
   * not on it yet. Absent when keyloom never synced it or the build came from another layout.
   */
  lastKnown?: { changes: number | null };
};

const NEEDS_HAND_REASON = "keyloom couldn't restart it by itself";

export function deriveState(f: SyncFacts): SyncState {
  const a = f.active;
  if (a && isActive(a)) {
    if (a.step === "needs_hand") return { kind: "needs_hand", instruction: a.instruction ?? "", reason: NEEDS_HAND_REASON };
    return { kind: "syncing", step: a.step === "done" ? "building" : a.step, syncId: a.id, startedAt: a.startedAt, trigger: a.trigger };
  }
  // Preserve failed history, but a later successful flash corroborated by every visible half supersedes it.
  const unsuperseded = (sync: SyncRow | undefined): SyncRow | undefined =>
    sync?.status === "failed" && f.reading.state === "keyloom" && !f.reading.missingHalves?.length &&
    f.runningFlashedAt !== undefined && f.runningFlashedAt > (sync.finishedAt ?? sync.startedAt) ? undefined : sync;
  const h = unsuperseded(f.headSync);
  const latest = unsuperseded(f.latestSync ?? f.headSync);
  if (f.split && latest?.status === "failed" && (latest.failure === "flash" || latest.failure === "verify" || latest.failure === "needs_hand") && f.reading.state !== "keyloom") {
    return { kind: "needs_hand", instruction: latest.error ?? latest.instruction ?? "Connect every half, then press Sync now.", reason: "" };
  }
  if (f.reading.state === "keyloom" && f.reading.missingHalves?.length) {
    return {
      kind: "needs_hand",
      instruction: latest?.status === "failed" && latest.error ? latest.error : `keyloom cannot confirm the ${f.reading.missingHalves.join(" and ")}. Connect every half, then press Sync now.`,
      reason: "",
    };
  }
  // A visible head marker does not undo a failed flash or prove the rest of a split keyboard recovered.
  if (latest?.status === "failed" && f.reading.state === "keyloom" && f.split && (latest.failure === "flash" || latest.failure === "verify" || latest.failure === "needs_hand")) {
    if (latest.failure === "needs_hand") return { kind: "needs_hand", instruction: [latest.error, latest.instruction].filter(Boolean).join(" "), reason: NEEDS_HAND_REASON };
    return { kind: "behind", changes: f.running.kind === "behind" ? f.running.changes : null, why: "failed", error: latest.error };
  }
  if (f.reading.state === "absent") {
    const changes = f.lastKnown?.changes;
    return changes === undefined || changes === 0 ? { kind: "not_connected" } : { kind: "not_connected", changes };
  }
  if (f.reading.state === "bootloader") {
    return {
      kind: "needs_hand",
      instruction: "Unplug the keyboard and plug it in again. If it still doesn't type, press Sync now.",
      reason: "it is in its bootloader, so it isn't running any firmware",
    };
  }
  if (f.reading.state === "other") return { kind: "not_keyloom", detail: f.reading.detail };
  if (f.reading.state === "remapping_off") return { kind: "behind", changes: null, why: "remapping_off", error: null };

  const changes = f.running.kind === "behind" ? f.running.changes : null;
  if (h?.status === "failed" && h.failure === "needs_hand") {
    return { kind: "needs_hand", instruction: h.instruction ?? h.error ?? "", reason: NEEDS_HAND_REASON };
  }
  if (h?.status === "failed" && !RETRYABLE_FAILURES.includes(h.failure ?? "flash")) return { kind: "behind", changes, why: "failed", error: h.error };
  if (f.running.kind === "same") return { kind: "in_sync" };
  if (f.running.kind === "unknown") return { kind: "behind", changes: null, why: "unknown_build", error: null };
  if (f.running.kind === "other_config") return { kind: "behind", changes: null, why: "other_config", error: null };
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
