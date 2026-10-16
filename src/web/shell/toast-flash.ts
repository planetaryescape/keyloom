// A toast that has to outlive the page it was raised on (D-316): switching config remounts the layout page, which drops its toasts, so
// "Archived X" or "Made X" is left in sessionStorage and shown once by the page that opens next. Storage can be missing or throw; then
// the toast is shown where it was raised, and the new page starts without it.
import type { ToastInput } from "./Toasts.tsx";

const KEY = "keyloom.toast-flash";

/** Leaves a toast for the next page; false when storage isn't there, so the caller shows it now instead. */
export function leaveToast(toast: ToastInput): boolean {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(toast));
    return true;
  } catch {
    return false;
  }
}

/** The toast left for this page, taken so it shows once; null when there is none or it can't be read. */
export function takeToast(): ToastInput | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ToastInput>;
    if ((parsed.kind !== "info" && parsed.kind !== "success" && parsed.kind !== "error") || typeof parsed.message !== "string") return null;
    return { kind: parsed.kind, message: parsed.message, ...(typeof parsed.detail === "string" ? { detail: parsed.detail } : {}) };
  } catch {
    return null;
  }
}
