import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ToastKind = "success" | "info" | "error";
export interface ToastInput {
  kind: ToastKind;
  message: string;
  detail?: string;
  /** The one thing to do about it, such as Restore; pressing it closes the toast. */
  action?: { label: string; run: () => void };
}
interface Toast extends ToastInput {
  id: number;
}

const ICONS = { success: CircleCheck, info: Info, error: CircleAlert } as const;
// 4 s for news (18: toasts disappear after 4 s); an error stays longer because it is what to read next.
const LIFETIME_MS: Record<ToastKind, number> = { success: 4000, info: 4000, error: 8000 };
/** A toast with a button stays at least this long, so there is time to read it and reach the button (R2-14). */
export const ACTION_MIN_MS = 12_000;
/** After the pointer leaves or focus moves on, a toast stays at least this long, so it doesn't vanish under the hand. */
export const RELEASE_MIN_MS = 2000;
const MAX_SHOWN = 3;

export const toastLifetime = (kind: ToastKind, hasAction: boolean): number => (hasAction ? Math.max(ACTION_MIN_MS, LIFETIME_MS[kind]) : LIFETIME_MS[kind]);

type Clock = { now: () => number; set: (fn: () => void, ms: number) => unknown; clear: (timer: unknown) => void };
const realClock: Clock = { now: () => Date.now(), set: (fn, ms) => window.setTimeout(fn, ms), clear: (timer) => window.clearTimeout(timer as number) };

/**
 * A countdown that stops while something holds it: the pointer over the toast, or focus inside it. When the last hold ends it runs on
 * with the time it had left, and never less than RELEASE_MIN_MS.
 */
export function dismissTimer(ms: number, onDone: () => void, clock: Clock = realClock) {
  let remaining = ms;
  let started = clock.now();
  let timer: unknown = clock.set(onDone, ms);
  const holds = new Set<string>();
  return {
    hold(reason: string): void {
      if (holds.has(reason)) return;
      holds.add(reason);
      if (holds.size > 1 || timer === undefined) return;
      clock.clear(timer);
      timer = undefined;
      remaining -= clock.now() - started;
    },
    release(reason: string): void {
      if (!holds.delete(reason) || holds.size > 0) return;
      started = clock.now();
      remaining = Math.max(remaining, RELEASE_MIN_MS);
      timer = clock.set(onDone, remaining);
    },
    stop(): void {
      if (timer !== undefined) clock.clear(timer);
      timer = undefined;
    },
  };
}

export function useToasts(): { toasts: Toast[]; show: (toast: ToastInput) => void; dismiss: (id: number) => void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((toast) => toast.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    next.current += 1;
    const id = next.current;
    setToasts((all) => [...all.slice(-(MAX_SHOWN - 1)), { ...toast, id }]);
  }, []);
  return { toasts, show, dismiss };
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICONS[toast.kind];
  const timer = useRef<ReturnType<typeof dismissTimer> | null>(null);
  const hasAction = toast.action !== undefined;
  // The parent passes a new onDismiss each render; the countdown starts once per toast, so a held toast is never restarted underneath.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const t = dismissTimer(toastLifetime(toast.kind, hasAction), () => dismiss.current());
    timer.current = t;
    return () => t.stop();
  }, [toast.kind, hasAction]);
  return (
    <div
      className="toast"
      data-kind={toast.kind}
      role={toast.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => timer.current?.hold("pointer")}
      onMouseLeave={() => timer.current?.release("pointer")}
      onFocus={() => timer.current?.hold("focus")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) timer.current?.release("focus");
      }}
    >
      <Icon size={16} aria-hidden="true" />
      <p className="toast-text">
        <strong>{toast.message}</strong>
        {toast.detail === undefined ? null : <span>{toast.detail}</span>}
      </p>
      {toast.action === undefined ? null : (
        <button type="button" className="button toast-action" onClick={() => { toast.action?.run(); onDismiss(); }}>{toast.action.label}</button>
      )}
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

// Sits over the foot of the stage, so a message never pushes the board or the tabs (18).
export function Toasts({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}
