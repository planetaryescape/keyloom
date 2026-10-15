import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

export type NoticeKind = "success" | "info" | "error";
export interface NoticeState {
  kind: NoticeKind;
  message: string;
  detail?: string;
}

const ICONS = { success: CircleCheck, info: Info, error: CircleAlert } as const;

// One line about what just happened. Errors interrupt a screen reader; the rest wait their turn.
export function Notice({ kind, message, detail, onDismiss }: NoticeState & { onDismiss: () => void }) {
  const Icon = ICONS[kind];
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <p className="notice-text">
        <strong>{message}</strong>
        {detail === undefined ? null : <span>{detail}</span>}
      </p>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={onDismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
