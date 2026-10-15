import type { CSSProperties } from "react";
import type { KeyLabel } from "./labels.ts";

interface KeyProps {
  style: CSSProperties;
  label: KeyLabel;
}

export function Key({ style, label }: KeyProps) {
  const classes = label.faded ? "key key-faded" : "key";
  const title = [label.main, label.sub, label.badge].filter(Boolean).join(" ");
  return (
    <div className={classes} style={style} title={title}>
      <span className="key-main">{label.main}</span>
      {label.sub ? <span className="key-sub">{label.sub}</span> : null}
      {label.badge ? <span className="key-badge">{label.badge}</span> : null}
    </div>
  );
}
