// What the header says about a keyboard (17#apply-sync-and-the-keyboards-state). Plain words, one place, so the pill, the
// popover and the toasts agree, and so the wording is tested without a browser.
import type { BoardSync } from "../../api/http.ts";

export type SyncTone = "success" | "busy" | "neutral" | "warning" | "error";
export type SyncActionId = "sync_now" | "flash_keyloom";

export interface SyncLine {
  /** The pill's text. */
  label: string;
  /** The pill's text on a phone, where the header keeps only the state. */
  short: string;
  /** A sentence under the label in the popover: why, or what to do. */
  detail: string | null;
  tone: SyncTone;
  action: { id: SyncActionId; label: string } | null;
}

// A software remapper has no build or flash: the words say what it does instead (21).
const REMAPPER_STEP_WORDS = {
  building: "Writing…",
  restarting: "Writing…",
  writing: "Writing…",
  verifying: "Checking kanata loaded it…",
} as const;

const STEP_WORDS = {
  building: "Building…",
  restarting: "Restarting it…",
  writing: "Flashing…",
  verifying: "Checking it came back…",
} as const;

const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** `selectedLayoutId` is the layout on screen: a keyboard that runs another layout of the same board says so. */
export function syncLine(board: BoardSync, selectedLayoutId: string | null): SyncLine {
  const name = board.boardName;
  const s = board.state;
  const other = selectedLayoutId !== null && selectedLayoutId !== board.layoutId;
  if (other && (s.kind === "in_sync" || s.kind === "behind")) {
    return {
      label: `Your ${name} runs “${board.layoutName}”`, short: "Other layout",
      detail: `This layout isn't on it. Put it there and “${board.layoutName}” stops being what the ${name} runs.`,
      tone: "neutral", action: { id: "sync_now", label: "Put this layout on it" },
    };
  }
  if (board.remapper === true) return remapperLine(board, name, s);
  switch (s.kind) {
    case "in_sync":
      return { label: `On your ${name}`, short: "In sync", detail: "The keyboard is running the latest change.", tone: "success", action: null };
    case "syncing":
      return {
        label: STEP_WORDS[s.step], short: "Syncing",
        detail: s.step === "building" ? "Building the firmware. Your keyboard keeps working meanwhile." : s.step === "verifying" ? "Written. Waiting for the keyboard to restart so keyloom can confirm it." : "Don't unplug the keyboard.",
        tone: "busy", action: null,
      };
    case "behind": {
      const label = s.changes === null || s.changes === 0 ? `Changes not on your ${name}` : `${plural(s.changes, "change", "changes")} not on your ${name}`;
      const detail =
        s.why === "failed" ? (s.error ?? "The last sync failed.")
        : s.why === "waiting" ? (s.error ? `${s.error} Trying again.` : "Syncing in a moment.")
        : s.why === "paused" ? "Auto-sync is paused."
        : s.why === "auto_off" ? "Auto-sync is off for this keyboard."
        : s.why === "unproven" ? "Auto-sync turns on after keyloom flashes this keyboard by itself once and sees it come back. Sync now to do that."
        : s.why === "other_config" ? `Your ${name} runs a different config. Put this one on from the config menu to replace it.`
        : s.why === "unknown_build" ? `Your ${name} runs a keyloom build this copy doesn't know, so keyloom won't replace it by itself.`
        : "Something else was flashed since this change.";
      return { label, short: "Behind", detail, tone: s.why === "failed" ? "error" : "neutral", action: { id: "sync_now", label: "Sync now" } };
    }
    case "needs_hand":
      return {
        label: "Needs a hand", short: "Needs a hand",
        // The flasher's own words already say why ("keyloom couldn't restart..."); the reason is added only where they don't.
        detail: s.instruction.toLowerCase().includes("couldn't") || s.reason === "" ? s.instruction : `${s.instruction} ${s.reason[0]?.toUpperCase()}${s.reason.slice(1)}.`,
        tone: "warning", action: { id: "sync_now", label: "Try again" },
      };
    case "not_connected":
      // A change applied while it is unplugged is the one thing worth saying: it isn't on the keyboard yet (amber, D-263).
      if (s.changes != null && s.changes > 0) {
        return { label: `${plural(s.changes, "change", "changes")} not on your ${name}`, short: "Not connected", detail: board.auto.on && !board.auto.paused ? `Your ${name} isn't connected. Plug it in and keyloom sends ${s.changes === 1 ? "it" : "them"}.` : `Your ${name} isn't connected. Plug it in, then sync.`, tone: "neutral", action: null };
      }
      return { label: `${name} not connected`, short: "Not connected", detail: "Plug it in and keyloom checks it.", tone: "neutral", action: null };
    case "not_keyloom":
      return {
        label: "Running firmware keyloom didn't build", short: "Not keyloom's", detail: `${s.detail}. keyloom never replaces it by itself.`,
        tone: "warning", action: { id: "flash_keyloom", label: "Flash keyloom's build" },
      };
  }
}

function remapperLine(board: BoardSync, name: string, s: BoardSync["state"]): SyncLine {
  switch (s.kind) {
    case "in_sync":
      return { label: `On your ${name}`, short: "In sync", detail: "kanata is running the latest change.", tone: "success", action: null };
    case "syncing":
      return { label: REMAPPER_STEP_WORDS[s.step], short: "Syncing", detail: "Writing the config and reloading it. Your keyboard keeps working meanwhile.", tone: "busy", action: null };
    case "behind": {
      const label = s.why === "remapping_off" ? "Remapping is off" : s.changes === null || s.changes === 0 ? `Changes not on your ${name}` : `${plural(s.changes, "change", "changes")} not on your ${name}`;
      const detail =
        s.why === "remapping_off" ? "Your MacBook keyboard is typing plainly. Turn remapping back on to get your layout."
        : s.why === "failed" ? (s.error ?? "The last apply failed.")
        : s.why === "waiting" ? (s.error ? `${s.error} Trying again.` : "Applying in a moment.")
        : s.why === "paused" ? "Auto-apply is paused."
        : s.why === "auto_off" ? "Auto-apply is off for this keyboard."
        : s.why === "unproven" ? "Auto-apply turns on after you prove kanata's emergency exit once (hold Left Control + Space + Escape), then run keyloom remap confirm-exit-chord."
        : "Something else was loaded since this change.";
      return { label, short: s.why === "remapping_off" ? "Off" : "Behind", detail, tone: s.why === "failed" ? "error" : "neutral", action: { id: "sync_now", label: s.why === "remapping_off" ? "Turn remapping on" : "Apply now" } };
    }
    case "needs_hand":
      return { label: "Needs a hand", short: "Needs a hand", detail: s.instruction, tone: "warning", action: { id: "sync_now", label: "Try again" } };
    case "not_connected":
      return { label: `kanata isn't running`, short: "Not running", detail: "Run keyloom doctor to see what is missing. Until kanata runs, the MacBook keyboard types plainly.", tone: "neutral", action: null };
    case "not_keyloom":
      return { label: "kanata runs a config keyloom didn't write", short: "Not keyloom's", detail: `${s.detail}. keyloom never replaces it by itself.`, tone: "warning", action: null };
  }
}

/** What auto-sync does, for the popover's switch. */
export function autoSyncLine(board: BoardSync): { on: boolean; canTurnOn: boolean; note: string | null } {
  const a = board.auto;
  return {
    on: a.on,
    canTurnOn: a.proven,
    note: a.proven ? null : board.remapper === true
      ? "Turns on after you prove kanata's emergency exit once: hold Left Control + Space + Escape, see kanata stop, then run keyloom remap confirm-exit-chord."
      : "Turns on after keyloom flashes this keyboard by itself once and sees it come back.",
  };
}

const seconds = (ms: number | null): string | null => (ms === null ? null : `${Math.max(1, Math.round(ms / 1000))} s`);

/** The toast for a board whose state just changed, or null when nothing needs saying. */
export function syncNotice(before: BoardSync | undefined, after: BoardSync): { kind: "success" | "error"; message: string; detail?: string } | null {
  if (before === undefined || before.state.kind === after.state.kind) return null;
  const was = before.state.kind;
  const now = after.state;
  if (was === "syncing" && now.kind === "in_sync") {
    const took = seconds(after.last?.timings.totalMs ?? null);
    const ms = after.last?.timings.totalMs ?? null;
    // Under a second is the point of a remapper, so it says milliseconds instead of rounding up to one second.
    if (after.remapper === true && ms !== null && ms < 1000) return { kind: "success", message: `On your ${after.boardName}`, detail: `${Math.round(ms)} ms from your change.` };
    return { kind: "success", message: `On your ${after.boardName}`, ...(took ? { detail: `${took} from your change.` } : {}) };
  }
  if (was === "syncing" && now.kind === "behind" && now.why === "failed") {
    return { kind: "error", message: `Couldn't put the change on your ${after.boardName}`, detail: now.error ?? "The sync failed." };
  }
  if (now.kind === "needs_hand") return { kind: "error", message: `Your ${after.boardName} needs a hand`, detail: now.instruction };
  return null;
}
