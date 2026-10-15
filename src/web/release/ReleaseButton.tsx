import { CircleAlert, CircleCheck, Hammer, LoaderCircle, Zap } from "lucide-react";
import type { ReleaseStatus } from "./status.ts";

const ICON = {
  idle: Hammer,
  busy: LoaderCircle,
  attention: Zap,
  success: CircleCheck,
  error: CircleAlert,
} as const;

// The header's way into the build and flash panel. Its label doubles as a progress readout, so
// closing the panel mid-build doesn't hide that something is happening.
export function ReleaseButton({ status, onOpen }: { status: ReleaseStatus; onOpen: () => void }) {
  const Icon = ICON[status.tone];
  return (
    <button type="button" className="button release-button" data-tone={status.tone} onClick={onOpen}>
      <Icon size={14} className={status.tone === "busy" ? "spin" : undefined} aria-hidden="true" />
      {status.label}
    </button>
  );
}
