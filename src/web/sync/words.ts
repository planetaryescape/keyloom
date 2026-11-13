// What the header says about a keyboard (17#apply-sync-and-the-keyboards-state). Plain words, one place, so the pill, the
// popover and the toasts agree, and so the wording is tested without a browser.
import type { BoardSync } from "../../api/http.ts";
import { syncBuildFailureLine } from "../release/build-failure-words.ts";
import { plain } from "../release/release-words.ts";

export type SyncTone = "success" | "busy" | "neutral" | "warning" | "error";
/**
 * What a line's button does. `put_on` opens the put-on confirm (D-300), `open_release` the Build and flash dialog, where Docker's own
 * callout lives, and `replace_foreign` the confirm that replaces a kanata config keyloom didn't write (R1-17).
 */
export type SyncActionId = "sync_now" | "flash_keyloom" | "put_on" | "open_release" | "replace_foreign";

export interface SyncLine {
  /** The pill's text. */
  label: string;
  /** The pill's text on a phone, where the header keeps only the state. */
  short: string;
  /** A sentence under the label in the popover: why, or what to do. */
  detail: string | null;
  tone: SyncTone;
  /** What keyloom read, for those who want it, behind "Details" (a USB serial): never in the line's one sentence. */
  more?: string;
  /** `buildId`: the sync's failed build, which `open_release` opens the dialog on (R8-01). */
  action: { id: SyncActionId; label: string; buildId?: string } | null;
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

/**
 * The last sync failed at its build (R3-05, R8-01). Its error is the CLI's sentence, with commands and a log path, so the line and the toast
 * say what the build's code means instead, and Build and flash opens on that build, where its buttons are.
 */
const buildFailed = (board: BoardSync): boolean => board.last?.failure === "build";
const dockerNotReady = (board: BoardSync): boolean => buildFailed(board) && board.last?.errorCode === "docker_unavailable";
const buildStopped = (board: BoardSync): boolean => buildFailed(board) && board.last?.errorCode === "cancelled";
/**
 * A sync that failed after its build. A flash code the page has its own words for says them, because the flasher's sentence names a CLI
 * flag (R8-11); any other sentence loses its backticks.
 */
function failedSyncText(board: BoardSync, error: string): string {
  if (board.last?.failure === "flash" && board.last.errorCode === "write_timeout") {
    return "Flashing didn't finish within 3 minutes, so keyloom stopped it. The keyboard may be left in its bootloader, where it doesn't type. Sync now flashes it again.";
  }
  return plain(error);
}

/** Build and flash, on the sync's failed build when it made one. Called only for a sync that failed at its build. */
function openFailedBuild(board: BoardSync): { id: "open_release"; label: string; buildId?: string } {
  const buildId = board.last?.buildId ?? undefined;
  return { id: "open_release", label: "Build and flash…", ...(buildId === undefined ? {} : { buildId }) };
}

/** `selectedLayoutId` is the layout on screen: a keyboard that runs another layout of the same board says so. */
export function syncLine(board: BoardSync, selectedLayoutId: string | null): SyncLine {
  const name = board.boardName;
  const s = board.state;
  const other = selectedLayoutId !== null && selectedLayoutId !== board.layoutId;
  if (other && (s.kind === "in_sync" || s.kind === "behind")) {
    return {
      label: `Your ${name} runs “${board.layoutName}”`, short: "Other layout",
      detail: `This layout isn't on it. Put it there and “${board.layoutName}” stops being what the ${name} runs.`,
      tone: "neutral", action: { id: "put_on", label: "Put this layout on it" },
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
        s.why === "failed" && buildFailed(board) ? syncBuildFailureLine(board.last?.errorCode)
        : s.why === "failed" ? failedSyncText(board, s.error ?? "The last sync failed.")
        : s.why === "waiting" ? (s.error ? `${plain(s.error)} Trying again.` : "Syncing in a moment.")
        : s.why === "paused" ? "Auto-sync is paused."
        : s.why === "auto_off" ? "Auto-sync is off for this keyboard."
        : s.why === "unproven" ? "Auto-sync turns on after keyloom flashes this keyboard by itself once and sees it come back. Sync now to do that."
        : s.why === "other_config" ? `Your ${name} runs a different config. Put “${board.layoutName}” on it to replace that one.`
        : s.why === "unknown_build" ? `Your ${name} runs a keyloom build this copy doesn't know, so keyloom won't replace it by itself.`
        : "Something else was flashed since this change.";
      return { label, short: "Behind", detail, tone: s.why === "failed" ? "error" : "neutral", action: behindAction(board, s.why) };
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
      // A board keyloom can't see until its firmware is on it would read "not connected" while plugged in; the build is the way in (R6-10).
      if (s.firstFlash === true) {
        return { label: `Put keyloom's firmware on your ${name}`, short: "Not seen yet", detail: `keyloom sees your ${name} once keyloom's firmware is on it.`, tone: "neutral", action: { id: "open_release", label: "Build and flash…" } };
      }
      return { label: `${name} not connected`, short: "Not connected", detail: "Plug it in and keyloom checks it.", tone: "neutral", action: null };
    case "not_keyloom":
      return {
        // The reading ("the right half reports USB serial …") is why keyloom thinks so; the sentence around it says what it means.
        label: "Running firmware keyloom didn't build", short: "Not keyloom's", detail: "Flash keyloom's build once to sync from then on.", more: `${s.detail}. keyloom never replaces it by itself.`,
        tone: "warning", action: { id: "flash_keyloom", label: "Flash keyloom's build" },
      };
  }
}

// Sync now is offered only where it can succeed. Another config on the keyboard is a choice (D-300), and a failed build is answered in
// Build and flash, which says what the build needs (Docker's callout) and shows its log; repeating it from here would fail the same way.
function behindAction(board: BoardSync, why: Extract<BoardSync["state"], { kind: "behind" }>["why"]): SyncLine["action"] {
  if (why === "other_config") return { id: "put_on", label: `Put “${board.layoutName}” on it` };
  // A stopped build has nothing to show: syncing again builds it again.
  if (why === "failed" && buildFailed(board) && board.last?.errorCode !== "cancelled") return openFailedBuild(board);
  return { id: "sync_now", label: "Sync now" };
}

/**
 * keyloom's last apply was refused because the keyloom.kbd on disk isn't keyloom's (R4 residual 2). Apply now would be refused the same
 * way, so the line offers Replace it, which keeps a copy of the file. kanata may still run keyloom's config, or remapping may be off.
 */
// The engine sends the code only while Replace it can still run: not after remapping was turned off since the failure.
const foreignFile = (board: BoardSync): boolean => board.last?.status === "failed" && board.last.errorCode === "foreign_file";
const FOREIGN_FILE_DETAIL = "Someone else wrote or edited keyloom.kbd, keyloom's config file, so keyloom left it alone. Replace it to put this layout on, and keyloom keeps a copy of that file.";
const REPLACE_FOREIGN = { id: "replace_foreign", label: "Replace it…" } as const;

function remapperLine(board: BoardSync, name: string, s: BoardSync["state"]): SyncLine {
  switch (s.kind) {
    case "in_sync":
      return { label: `On your ${name}`, short: "In sync", detail: "kanata is running the latest change.", tone: "success", action: null };
    case "syncing":
      return { label: REMAPPER_STEP_WORDS[s.step], short: "Syncing", detail: "Writing the config and reloading it. Your keyboard keeps working meanwhile.", tone: "busy", action: null };
    case "behind": {
      const label = s.why === "remapping_off" ? "Remapping is off" : s.changes === null || s.changes === 0 ? `Changes not on your ${name}` : `${plural(s.changes, "change", "changes")} not on your ${name}`;
      const foreign = (s.why === "failed" || s.why === "remapping_off") && foreignFile(board);
      if (foreign) {
        return {
          label, short: s.why === "remapping_off" ? "Off" : "Behind", detail: s.why === "remapping_off" ? `Your MacBook keyboard is typing plainly. ${FOREIGN_FILE_DETAIL}` : FOREIGN_FILE_DETAIL,
          ...(board.last?.error ? { more: board.last.error } : {}), tone: s.why === "failed" ? "error" : "neutral", action: REPLACE_FOREIGN,
        };
      }
      const detail =
        s.why === "remapping_off" ? "Your MacBook keyboard is typing plainly. Turn remapping back on to get your layout."
        : s.why === "failed" ? (s.error ?? "The last apply failed.")
        : s.why === "waiting" ? (s.error ? `${s.error} Trying again.` : "Applying in a moment.")
        : s.why === "paused" ? "Auto-apply is paused."
        : s.why === "auto_off" ? "Auto-apply is off for this keyboard."
        : s.why === "unproven" ? "Auto-apply turns on after you prove kanata's emergency exit once. The steps are under “Auto-apply is off” below."
        : "Something else was loaded since this change.";
      return { label, short: s.why === "remapping_off" ? "Off" : "Behind", detail, tone: s.why === "failed" ? "error" : "neutral", action: { id: "sync_now", label: s.why === "remapping_off" ? "Turn remapping on" : "Apply now" } };
    }
    case "needs_hand":
      return { label: "Needs a hand", short: "Needs a hand", detail: s.instruction, tone: "warning", action: { id: "sync_now", label: "Try again" } };
    case "not_connected":
      // The popover lists what is missing, with a button for each (D-493).
      return { label: `kanata isn't running`, short: "Not running", detail: "Until kanata runs, your MacBook keyboard types plainly.", tone: "neutral", action: null };
    case "not_keyloom":
      return {
        label: "kanata runs a config keyloom didn't write", short: "Not keyloom's", detail: "keyloom never replaces it by itself. Replace it to put this layout on, and keyloom keeps a copy.", more: `${s.detail}.`,
        tone: "warning", action: REPLACE_FOREIGN,
      };
  }
}

/**
 * What auto-sync does, for the popover's switch. `name` is what the switch is called: a remapper applies a config, it doesn't sync
 * firmware, so the MacBook's switch and the words that point at it say "Auto-apply" (R2-11). `exitChord` says whether the popover offers
 * "I held it and kanata stopped": only once keyloom has seen kanata run its config recently (D-509), and the note says why it isn't there.
 */
export type AutoSyncLine = { name: "Auto-sync" | "Auto-apply"; on: boolean; canTurnOn: boolean; note: string | null; exitChord: boolean };

export function autoSyncLine(board: BoardSync): AutoSyncLine {
  const a = board.auto;
  // The server sends it true only for an unproven remapper (D-509).
  const exitChord = a.exitChordReady === true;
  return {
    name: board.remapper === true ? "Auto-apply" : "Auto-sync",
    on: a.on,
    canTurnOn: a.proven,
    note: a.proven ? null : board.remapper !== true ? "Turns on after keyloom flashes this keyboard by itself once and sees it come back."
      : exitChord ? "Turns on after you prove kanata's emergency exit once: hold Left Control + Space + Escape until your MacBook keyboard types plainly, then press the button below."
      : board.state.kind === "not_keyloom" ? "Turns on after you prove kanata's emergency exit once. That step appears when kanata runs a config keyloom wrote, so replace the one it runs first."
      : "Turns on after you prove kanata's emergency exit once. That step appears when keyloom sees kanata running, so a kanata that never started can't count. Start kanata first.",
    exitChord,
  };
}

const seconds = (ms: number | null): string | null => (ms === null ? null : `${Math.max(1, Math.round(ms / 1000))} s`);

/** The toast for a board whose state just changed, or null when nothing needs saying. `action` is the toast's button. */
export type SyncNotice = {
  kind: "success" | "error"; message: string; detail?: string;
  action?: { id: RefusalAction | "open_board"; label: string; buildId?: string } | { id: "open_config"; label: string; layoutId: string };
};

/**
 * A notice as the page on screen can act on it. Its button acts on the layout on screen, so a notice about another keyboard (its
 * auto-sync ran while this page was open) offers to open that keyboard instead, where its sync line has the same button. A notice about
 * another config of this keyboard (the person moved on while its build ran) opens that config the same way: Build and flash here would
 * open this config's dialog on the other config's build (PR #306 review).
 */
export function noticeOnPage(notice: SyncNotice, board: Pick<BoardSync, "boardId" | "boardName" | "layoutId" | "layoutName">, page: { boardId: string; layoutId: string } | undefined): SyncNotice {
  if (notice.action === undefined || page === undefined) return notice;
  const label = notice.action.label.replace(/…$/, "");
  if (board.boardId !== page.boardId) return { ...notice, detail: `${notice.detail ?? ""} Its page has ${label}.`.trim(), action: { id: "open_board", label: `Open ${board.boardName}` } };
  if (board.layoutId === page.layoutId) return notice;
  return { ...notice, detail: `${notice.detail ?? ""} ${board.layoutName}'s page has ${label}.`.trim(), action: { id: "open_config", label: `Open ${board.layoutName}`, layoutId: board.layoutId } };
}

export function syncNotice(before: BoardSync | undefined, after: BoardSync): SyncNotice | null {
  if (before === undefined) return null;
  if (before.state.kind === after.state.kind && !(before.state.kind === "needs_hand" && after.state.kind === "needs_hand" && before.state.instruction !== after.state.instruction)) return null;
  const was = before.state.kind;
  const now = after.state;
  if (was === "syncing" && now.kind === "in_sync") {
    if (after.last?.status === "failed") return { kind: "error", message: `Couldn't put the change on your ${after.boardName}`, detail: plain(after.last.error ?? "The sync failed.") };
    const took = seconds(after.last?.timings.totalMs ?? null);
    const ms = after.last?.timings.totalMs ?? null;
    // Under a second is the point of a remapper, so it says milliseconds instead of rounding up to one second.
    if (after.remapper === true && ms !== null && ms < 1000) return { kind: "success", message: `On your ${after.boardName}`, detail: `${Math.round(ms)} ms from your change.` };
    return { kind: "success", message: `On your ${after.boardName}`, ...(took ? { detail: `${took} from your change.` } : {}) };
  }
  // Turn remapping on that was refused leaves the state `remapping_off`, so the file is checked before the failed state is.
  if (was === "syncing" && now.kind === "behind" && after.remapper === true && foreignFile(after)) {
    return { kind: "error", message: `Couldn't put the change on your ${after.boardName}`, detail: FOREIGN_FILE_DETAIL, action: REPLACE_FOREIGN };
  }
  if (was === "syncing" && now.kind === "behind" && now.why === "failed") {
    if (dockerNotReady(after)) return { kind: "error", message: "Docker isn't ready", detail: `keyloom couldn't build the change for your ${after.boardName}. Build and flash shows what Docker needs.`, action: openFailedBuild(after) };
    // A stopped build has nothing to show in Build and flash; the pill offers Sync now.
    if (buildFailed(after)) {
      return { kind: "error", message: `Couldn't build the change for your ${after.boardName}`, detail: syncBuildFailureLine(after.last?.errorCode), ...(buildStopped(after) ? {} : { action: openFailedBuild(after) }) };
    }
    return { kind: "error", message: `Couldn't put the change on your ${after.boardName}`, detail: failedSyncText(after, now.error ?? "The sync failed.") };
  }
  if (now.kind === "needs_hand") return { kind: "error", message: `Your ${after.boardName} needs a hand`, detail: now.instruction };
  return null;
}

/** `open_status` opens the keyboard's status popover, where kanata's checklist is; `restore_keyboard` puts a removed keyboard back. */
export type RefusalAction = "restore" | "put_on" | "open_release" | "replace_foreign" | "check_exit_chord" | "open_status" | "restore_keyboard";

/**
 * The toast for a sync the server refused, from its code (R1-16). The server's own sentence names CLI commands, so it is never shown;
 * each code says what happened and offers the button that fixes it, where the page has one.
 */
export type RefusalNotice = { message: string; detail?: string; action?: { id: RefusalAction; label: string } };

export const refusalNotice = (code: string | undefined, message: string): RefusalNotice =>
  knownRefusal(code) ?? { message: "keyloom couldn't do that", detail: message };

/**
 * The words and button for a refusal code, or null for a code that isn't one (R3-01): a put-on refused by the sync engine gets the same
 * message and button as the toast, and any other failure is the caller's to say.
 */
export function knownRefusal(code: string | undefined): RefusalNotice | null {
  switch (code) {
    case "archived": return { message: "This config is archived", detail: "Restore it to put it on the keyboard.", action: { id: "restore", label: "Restore" } };
    case "not_on_keyboard": return { message: "This config isn't the one on the keyboard", detail: "Put it on to make it the config that syncs.", action: { id: "put_on", label: "Put it on…" } };
    case "cant_sync": return { message: "keyloom can't sync this keyboard by itself", detail: "Build and flash puts this layout on it.", action: { id: "open_release", label: "Build and flash…" } };
    case "foreign_firmware": return { message: "The keyboard runs firmware keyloom didn't build", detail: "keyloom never replaces it by itself. Build and flash replaces it after you confirm.", action: { id: "open_release", label: "Build and flash…" } };
    case "kanata_foreign": return { message: "kanata runs a config keyloom didn't write", detail: "keyloom never replaces it by itself.", action: { id: "replace_foreign", label: "Replace it…" } };
    case "kanata_not_running": return { message: "kanata isn't running", detail: "The keyboard's status lists what is missing, with a button for each.", action: { id: "open_status", label: "Open keyboard status" } };
    case "not_connected": return { message: "The keyboard isn't connected", detail: "Plug it in and keyloom checks it." };
    case "busy": return { message: "keyloom is already building or flashing", detail: "Try again when it finishes." };
    // Sync now asks again by itself while the page is open (R3-18, busy-retry.ts), and says so when it stops asking.
    case "busy_waiting": return { message: "keyloom is already building or flashing", detail: "keyloom syncs this when that finishes." };
    case "busy_timed_out": return { message: "keyloom is still building or flashing", detail: "It has been busy for 15 minutes, so keyloom stopped waiting. The keyboard's status shows what is running.", action: { id: "open_status", label: "Open keyboard status" } };
    case "kanata_still_running": return { message: "kanata is still running", detail: "Hold Left Control, Space and Escape together until your MacBook keyboard types plainly, then check again.", action: { id: "check_exit_chord", label: "Check again" } };
    case "kanata_not_seen": return { message: "keyloom hasn't seen kanata running lately", detail: "A kanata that stopped long ago, or never started, doesn't show the chord worked. Start kanata, then hold Left Control, Space and Escape and press the button again.", action: { id: "open_status", label: "Open keyboard status" } };
    case "kanata_unreadable": return { message: "keyloom couldn't tell whether kanata stopped", detail: "kanata's port didn't answer, so nothing was recorded. Check again in a moment.", action: { id: "check_exit_chord", label: "Check again" } };
    case "kanata_not_foreign": return { message: "kanata's config changed, so nothing was replaced", detail: "The keyboard's status shows what kanata runs now.", action: { id: "open_status", label: "Open keyboard status" } };
    // kanata didn't take the plain map: the status popover shows whether it runs, and the chord stops it if it is stuck (R7-08).
    case "disable_failed": return { message: "keyloom couldn't turn remapping off", detail: "kanata didn't take the change. If your MacBook keyboard types wrongly, hold Left Control, Space and Escape together to stop kanata.", action: { id: "open_status", label: "Open keyboard status" } };
    case "keyboard_removed": return { message: "This keyboard was removed from your setup", detail: "Restore it to sync it again. Its configs and history were kept.", action: { id: "restore_keyboard", label: "Restore" } };
    default: return null;
  }
}
