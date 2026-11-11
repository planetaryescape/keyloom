// What the release dialog and the proposal card say about a flash and an Apply (D-501), from the server's codes, never its sentences.
// Pure, so the wording is tested without a browser.
import type { BoardSync, FlashCheckResponse, FlashPermissionCode } from "../../api/http.ts";
import type { SettingsPaneName } from "../../api/system-remapper.ts";

/**
 * The System Settings pane a permission code opens, the button that opens it, and what to say beside it. `failed` replaces the server's
 * sentence when a flash failed for it, because that sentence names the settings path the button opens; the log keeps it.
 */
export type PermissionFix = { pane: SettingsPaneName; button: string; text: string; failed: string };

export function permissionFix(code: FlashPermissionCode | null | undefined): PermissionFix | null {
  switch (code) {
    case "permission_files_and_folders":
      return {
        pane: "files_and_folders", button: "Open Files and Folders settings",
        text: "Allow keyloom to use removable volumes, then flash again.",
        failed: "macOS didn't let keyloom write to the keyboard's drive, so that part wasn't flashed.",
      };
    case "permission_input_monitoring":
      return {
        pane: "input_monitoring", button: "Open Input Monitoring settings",
        text: "Allow keyloom in Input Monitoring, and the next flash needs no keypress.",
        failed: "macOS didn't let keyloom restart the keyboard by itself.",
      };
    default:
      return null;
  }
}

/** What Check the keyboard again found, and the button that follows: check once more, or flash again. */
export type CheckOutcome = { tone: "success" | "warning"; text: string; next: "check" | "flash" | null };

export function checkOutcome(found: FlashCheckResponse["found"], boardName: string): CheckOutcome {
  switch (found) {
    case "this_build": return { tone: "success", text: `Your ${boardName} runs this build. The flash is verified.`, next: null };
    case "other_build": return { tone: "warning", text: `Your ${boardName} runs a different keyloom build, so this flash didn't take. Flash it again.`, next: "flash" };
    case "missing_halves": return { tone: "warning", text: `Only part of your ${boardName} answered. Connect every half by USB, then check again.`, next: "check" };
    case "absent": return { tone: "warning", text: `keyloom can't see your ${boardName}. Plug it in by USB, then check again.`, next: "check" };
    case "bootloader": return { tone: "warning", text: `Your ${boardName} is still in its bootloader, so it isn't typing. Flash it again to finish.`, next: "flash" };
    case "other_firmware": return { tone: "warning", text: `Your ${boardName} runs firmware keyloom didn't build. Flash it again to put this build on it.`, next: "flash" };
  }
}

/** What the proposal card says once a change is applied (`lead` in bold, then `text`), and its one button, for the board the layout is on (R2-01). */
export type AfterApply = {
  lead: string;
  text: string;
  /** The same news in a few words, for the Applied toast that follows an Apply from chat. */
  toast: string;
  action: { id: "apply_now" | "open_release" | "put_on"; label: string } | null;
};

const UNDO = "Undo above the board takes it back.";

/**
 * A MacBook keyboard is never built or flashed: kanata applies the config, by itself when auto-apply is on, or from Apply now. A
 * keyboard that auto-syncs gets the change by itself. Any other gets Build and flash, as before.
 */
export function afterApply(board: { firmware: string; name: string }, sync: BoardSync | undefined, layoutId: string): AfterApply {
  // The caller passes the name the page shows ("MacBook", not "MacBook keyboard (ANSI)").
  const name = board.name;
  const auto = sync !== undefined && sync.auto.on && !sync.auto.paused;
  if (sync !== undefined && sync.layoutId !== layoutId) {
    const text = `Your ${name} runs “${sync.layoutName}”, so this one isn't on it.`;
    const toast = `Your ${name} runs “${sync.layoutName}”.`;
    return board.firmware === "kanata"
      ? { lead: "Applied to this layout.", text, toast, action: { id: "put_on", label: "Put this layout on it" } }
      : { lead: "Applied to this layout.", text: `${text} ${UNDO}`, toast, action: { id: "open_release", label: "Build and flash" } };
  }
  if (board.firmware === "kanata") {
    if (auto) return { lead: "Applied.", text: `Auto-apply puts it on your ${name} in a moment. ${UNDO}`, toast: `Auto-apply puts it on your ${name}.`, action: null };
    return { lead: "Applied to your layout.", text: `It isn't on your ${name} yet. ${UNDO}`, toast: `It isn't on your ${name} yet.`, action: { id: "apply_now", label: "Apply now" } };
  }
  if (auto && sync.state.kind !== "not_keyloom") {
    return { lead: "Applied.", text: `Auto-sync builds it and puts it on your ${name} by itself. ${UNDO}`, toast: `Auto-sync puts it on your ${name}.`, action: null };
  }
  return { lead: "Applied to your layout.", text: "It isn't on your keyboard yet, and Undo above the board takes it back.", toast: "It isn't on your keyboard yet.", action: { id: "open_release", label: "Build and flash" } };
}
