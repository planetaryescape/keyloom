import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ToastKind = "success" | "info" | "error";
export interface ToastInput {
  kind: ToastKind;
  message: string;
  detail?: string;
}
interface Toast extends ToastInput {
  id: number;
}

const ICONS = { success: CircleCheck, info: Info, error: CircleAlert } as const;
// 4 s for news (18: toasts disappear after 4 s); an error stays longer because it is what to read next.
const LIFETIME_MS: Record<ToastKind, number> = { success: 4000, info: 4000, error: 8000 };
const MAX_SHOWN = 3;

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
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, LIFETIME_MS[toast.kind]);
    return () => window.clearTimeout(timer);
  }, [toast.kind, onDismiss]);
  return (
    <div className="toast" data-kind={toast.kind} role={toast.kind === "error" ? "alert" : "status"}>
      <Icon size={16} aria-hidden="true" />
      <p className="toast-text">
        <strong>{toast.message}</strong>
        {toast.detail === undefined ? null : <span>{toast.detail}</span>}
      </p>
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
