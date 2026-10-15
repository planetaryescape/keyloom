import { Eye, EyeOff } from "lucide-react";

interface Props {
  title: string;
  layerName: string;
  /** Pinned previews have a way out; a hover ends when the pointer leaves. */
  onStop: (() => void) | undefined;
}

// Sits where the revision bar does while a proposal is on the board, so the board never shifts
// and the picture is never mistaken for the saved layout.
export function PreviewBanner({ title, layerName, onStop }: Props) {
  return (
    <div className="preview-banner">
      <Eye size={16} aria-hidden="true" />
      <p>
        Previewing <strong>{title}</strong> on {layerName}. <span>Not applied.</span>
      </p>
      {onStop === undefined ? null : (
        <button type="button" className="button" onClick={onStop}>
          <EyeOff size={14} aria-hidden="true" />
          Stop previewing
        </button>
      )}
    </div>
  );
}
