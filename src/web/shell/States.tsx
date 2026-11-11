import { RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="loading" role="status">
      {children}
    </p>
  );
}

export function ErrorState({
  title,
  children,
  onRetry,
  actions,
}: {
  title: string;
  children: ReactNode;
  onRetry?: () => void;
  /** The ways forward when trying again can't help, such as Show your other layouts. */
  actions?: ReactNode;
}) {
  return (
    <section className="state state-error" role="alert">
      <span className="state-icon" aria-hidden="true">
        <TriangleAlert size={22} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {actions === undefined ? null : <div className="state-actions">{actions}</div>}
      {onRetry === undefined ? null : (
        <button type="button" className="button" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </button>
      )}
    </section>
  );
}
