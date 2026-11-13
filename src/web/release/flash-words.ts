// What the release dialog and the proposal card say about a flash and an Apply (D-501), from the server's codes, never its sentences.
// Pure, so the wording is tested without a browser.
import type { BoardSync, FlashCheckResponse, FlashErrorCode } from "../../api/http.ts";
import type { SettingsPaneName } from "../../api/system-remapper.ts";
import { wayOutFor } from "../shell/unexpected.ts";

/**
 * Why the firmware file couldn't be saved or shown in Finder, in the server's words. `gone`: keyloom has no file for this build any more
 * (`not_found`, "This build has no firmware file. Build it again."), so the step offers Build again (D-534).
 */
export type FileProblem = { text: string; gone: boolean };

export function fileProblem(error: unknown, fallback: string): FileProblem {
  if (!(error instanceof Error)) return { text: fallback, gone: false };
  return { text: error.message, gone: "code" in error && error.code === "not_found" };
}

/** A build whose firmware file went between Build and Flash: flashing again fails the same way, so the way on is a new build (R8-12). */
export const BUILD_FILE_GONE = "This build's firmware file is gone, so keyloom can't flash it. Build again to make a new one.";

/** The layout a build was asked for is gone (the route's own `not_found`): deleted in another window or by the CLI (D-540). */
export const LAYOUT_GONE = "keyloom no longer has this layout. It may have been deleted in another window. Restarting keyloom opens the page on the layouts it has.";

/**
 * The buttons beside the dialog's own error (R8-03, R8-12): Build again for a file that is gone, Restart keyloom (with Try again for a
 * server fault) for an answer no screen planned for, and Try again for anything else, which repeats what failed. `none`: the step's own
 * Build firmware is the way on, so the error has no button of its own (a sync's build that is gone, PR #306 review). `gone`: the build's
 * layout was deleted, which nothing in the dialog can bring back, so Restart keyloom alone opens the page on the layouts keyloom has.
 * `wayOutFor` decides what is unexpected, so keyloom's catch-all `not_found` is a version mismatch and a route's own is this dialog's (D-540).
 */
export function errorWayOut(code: string | null, generic = false): "build_again" | "unexpected" | "gone" | "try_again" | "none" {
  if (code === "build_file_gone") return "build_again";
  if (code === SYNC_BUILD_GONE_CODE) return "none";
  if (wayOutFor({ message: "", code: code ?? undefined, generic }, true) !== null) return "unexpected";
  return code === "not_found" ? "gone" : "try_again";
}

/**
 * A build or flash that couldn't start, as the dialog keeps it (D-540). The route's own `not_found` names what is gone: a flash's build,
 * whose way on is a new build (`build_file_gone`), or a build's layout, deleted elsewhere. keyloom's catch-all keeps its code and `generic`.
 */
export function startFailure(action: "build" | "flash", error: { message: string; code?: string | undefined; generic?: boolean | undefined }): { text: string; code: string | null; generic: boolean } {
  const generic = error.generic === true;
  if (error.code === "not_found" && !generic) return action === "flash" ? { text: BUILD_FILE_GONE, code: "build_file_gone", generic } : { text: LAYOUT_GONE, code: "not_found", generic };
  return { text: error.message, code: error.code ?? null, generic };
}

/** The page's own code for a sync's failed build that keyloom no longer has, so the dialog's error offers no read that can't pass. */
export const SYNC_BUILD_GONE_CODE = "sync_build_gone";

/**
 * What the dialog says when it couldn't read the sync's failed build it opened on (R8-01). A build that is gone (its config was deleted,
 * which deletes its builds) can't be read again, and a restart won't bring it back, so the words point at the step's Build firmware. Any
 * other failure keeps its code, and the words name only the buttons `errorWayOut` gives that code, with building again beside them.
 */
export function syncBuildReadFailure(code: string | null, generic = false): { text: string; code: string | null; generic?: true } {
  if (code === "not_found" && !generic) return { text: "The build that failed is no longer there, so keyloom can't show it. Build the firmware again to put this layout on the keyboard.", code: SYNC_BUILD_GONE_CODE };
  const retry = errorWayOut(code, generic) === "try_again" || wayOutFor({ message: "", code: code ?? undefined, generic }, true)?.retry === true;
  return { text: retry ? "keyloom couldn't read the build that failed. Try again to read it, or build the firmware again." : "keyloom couldn't read the build that failed. Build the firmware again, or restart keyloom.", code, ...(generic ? { generic: true as const } : {}) };
}

/**
 * The System Settings pane a permission code opens, the button that opens it, and what to say beside it. `failed` leads a failed
 * flash's message in plain words; the server's sentence follows it, because on a split board it also says how recovery went.
 */
export type PermissionFix = { pane: SettingsPaneName; button: string; text: string; failed: string };

export function permissionFix(code: FlashErrorCode | null | undefined): PermissionFix | null {
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

/**
 * A failed flash's message: plain words for its code when it has one, then the server's sentence, which is dropped only for a write that
 * timed out, whose sentence names a CLI flag (R8-11). A write
 * that finished but couldn't be confirmed says so first, because the keyboard may well run the new build.
 */
export function failedFlashText(code: FlashErrorCode | null | undefined, error: string | null): { lead: string | null; detail: string } {
  // The server's sentence names a CLI flag for an earlier build; the page's way on is the step's own Try again (R8-11).
  if (code === "write_timeout") return { lead: "Flashing didn't finish within 3 minutes, so keyloom stopped it.", detail: "The keyboard may be left in its bootloader, where it doesn't type. Try again to put this build on it." };
  const lead = code === "not_confirmed" ? "keyloom wrote the firmware, but couldn't confirm the keyboard runs it." : (permissionFix(code)?.failed ?? null);
  return { lead, detail: error ?? "Flashing failed." };
}

/**
 * What a Cancel that didn't stop the flash at once says beside the flash (D-506), from the server's answer and never its sentence:
 * refused because the write began (`flash_writing`), or accepted while the flash still waits, because keyloom looks at the keyboard
 * before it stops the flash tool. Null when the flash as it is now says enough.
 */
export function cancelNote(answer: { refused: string | undefined } | { status: string }): string | null {
  if ("refused" in answer) {
    if (answer.refused === "flash_writing") return "The keyboard was already in its bootloader, so keyloom couldn't stop the flash safely. It finishes by itself in a few seconds.";
    // `flash_finished` needs no words: the flash as it is now shows how it ended. Anything else never reached keyloom, or failed there,
    // so the flash may still be waiting and Cancel stays on screen (R3-20).
    if (answer.refused === "flash_finished") return null;
    return answer.refused === "unreachable"
      ? "keyloom didn't answer, so the flash may still be waiting. Check that keyloom is running, then cancel again."
      : "keyloom couldn't stop the flash. Cancel again.";
  }
  return answer.status === "waiting_for_bootloader" ? "Stopping the flash. If the keyboard has just entered its bootloader, keyloom writes it first." : null;
}

/** The answers to "Which <board> is this?", from the board's own revisions: their labels and hints, or their IDs (D-506). */
export function revisionChoices(revisions: ReadonlyArray<{ id: string; label?: string | undefined; hint?: string | undefined }>): Array<{ value: string; label: string; hint?: string }> {
  return revisions.map((r) => ({ value: r.id, label: r.label ?? r.id, ...(r.hint === undefined ? {} : { hint: r.hint }) }));
}

/** What Check the keyboard again found, and the button that follows: check once more, or flash again. */
export type CheckOutcome = { tone: "success" | "warning"; text: string; next: "check" | "flash" | null };

export function checkOutcome(found: FlashCheckResponse["found"], boardName: string): CheckOutcome {
  switch (found) {
    case "this_build": return { tone: "success", text: `Your ${boardName} runs this build. The flash is verified.`, next: null };
    case "later_build": return { tone: "success", text: `Your ${boardName} now runs a later keyloom build, which replaced this one. There is nothing to flash.`, next: null };
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
  /** `open_status` opens the keyboard's status, where kanata's setup checklist is; `replace_foreign` the confirm that replaces kanata's config. */
  action: { id: "apply_now" | "open_release" | "put_on" | "open_status" | "replace_foreign"; label: string } | null;
};

const UNDO = "Undo above the board takes it back.";

/**
 * A MacBook keyboard is never built or flashed: kanata applies the config, by itself when auto-apply is on, or from Apply now. A
 * keyboard that auto-syncs gets the change by itself. Any other gets Build and flash, as before.
 *
 * `revisionId` is the layout's revision as the page shows it now. The sync view speaks for this change only when its head is that
 * revision; before then (the toast, at the moment of the Apply) its state is the keyboard's before the change.
 */
export function afterApply(board: { firmware: string; name: string }, sync: BoardSync | undefined, layoutId: string, revisionId?: string): AfterApply {
  // The caller passes the name the page shows ("MacBook", not "MacBook keyboard (ANSI)").
  const name = board.name;
  const kanata = board.firmware === "kanata";
  if (sync !== undefined && sync.layoutId !== layoutId) {
    const text = `Your ${name} runs “${sync.layoutName}”, so this one isn't on it.`;
    const toast = `Your ${name} runs “${sync.layoutName}”.`;
    return board.firmware === "kanata"
      ? { lead: "Applied to this layout.", text, toast, action: { id: "put_on", label: "Put this layout on it" } }
      : { lead: "Applied to this layout.", text: `${text} ${UNDO}`, toast, action: { id: "open_release", label: "Build and flash" } };
  }
  const state = sync?.state;
  const fresh = sync !== undefined && revisionId !== undefined && sync.headRevisionId === revisionId;
  if (fresh && state?.kind === "in_sync") return { lead: "Applied.", text: `It is on your ${name}. ${UNDO}`, toast: `It is on your ${name}.`, action: null };
  if (fresh && state?.kind === "syncing") {
    const now = kanata ? `keyloom is applying it to your ${name} now.` : `keyloom is putting it on your ${name} now.`;
    return { lead: "Applied.", text: `${now} ${UNDO}`, toast: now, action: null };
  }
  // Auto-sync and auto-apply start only from these states (autoSyncDue): a keyboard that is unplugged, needs a hand, failed or runs
  // something else gets nothing by itself, so it is offered the button instead.
  const auto = sync !== undefined && sync.auto.on && !sync.auto.paused;
  const autoRuns = auto && (state?.kind === "in_sync" || state?.kind === "syncing" || (state?.kind === "behind" && state.why === "waiting"));
  if (kanata) {
    // keyloom.kbd on disk isn't keyloom's (R4 residual 2): auto-apply and Apply now would both be refused again until it is replaced.
    // Replace it needs kanata running, so a stopped kanata gets its setup below first (#290 review).
    if (sync?.last?.status === "failed" && sync.last.errorCode === "foreign_file" && state?.kind !== "not_connected") {
      return { lead: "Applied to your layout.", text: `keyloom's config file was changed by someone else, so this isn't on your ${name} yet. ${UNDO}`, toast: "keyloom's config file was changed by someone else.", action: { id: "replace_foreign", label: "Replace it…" } };
    }
    if (autoRuns) return { lead: "Applied.", text: `Auto-apply puts it on your ${name} in a moment. ${UNDO}`, toast: `Auto-apply puts it on your ${name}.`, action: null };
    // Apply now would be refused in these two states (R3-03): offer what gets kanata to a state where it works.
    if (state?.kind === "not_connected") {
      return { lead: "Applied to your layout.", text: `kanata isn't running, so it isn't on your ${name} yet. ${UNDO}`, toast: "kanata isn't running yet.", action: { id: "open_status", label: "Open keyboard status" } };
    }
    if (state?.kind === "not_keyloom") {
      return { lead: "Applied to your layout.", text: `kanata runs a config keyloom didn't write, so this isn't on your ${name} yet. ${UNDO}`, toast: "kanata runs a config keyloom didn't write.", action: { id: "replace_foreign", label: "Replace it…" } };
    }
    return { lead: "Applied to your layout.", text: `It isn't on your ${name} yet. ${UNDO}`, toast: `It isn't on your ${name} yet.`, action: { id: "apply_now", label: "Apply now" } };
  }
  if (autoRuns) return { lead: "Applied.", text: `Auto-sync builds it and puts it on your ${name} by itself. ${UNDO}`, toast: `Auto-sync puts it on your ${name}.`, action: null };
  if (auto && state?.kind === "not_connected") {
    return { lead: "Applied.", text: `Auto-sync puts it on your ${name} when you connect it by USB. ${UNDO}`, toast: `Auto-sync puts it on your ${name} when you connect it by USB.`, action: null };
  }
  return { lead: "Applied to your layout.", text: "It isn't on your keyboard yet, and Undo above the board takes it back.", toast: "It isn't on your keyboard yet.", action: { id: "open_release", label: "Build and flash" } };
}

/**
 * Why Cancel didn't stop a build, by the error's code (R3-10, R3-20). The build may still be running, so Cancel stays on screen.
 * `build_finished` never reaches here: the build is read again instead.
 */
export function buildCancelProblem(code: string | undefined): string {
  return code === "unreachable"
    ? "keyloom didn't answer, so the build may still be running. Check that keyloom is running, then cancel again."
    : "keyloom couldn't stop the build. Cancel again, or wait for it to finish.";
}
