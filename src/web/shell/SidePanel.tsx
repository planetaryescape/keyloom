import type { ReactNode } from "react";

export type PanelMode = "summary" | "key" | "chat" | "repeat";

interface Props {
  mode: PanelMode;
  summary: ReactNode;
  key_: ReactNode;
  chat: ReactNode;
  repeat: ReactNode;
}

// One thing at a time (18#the-board-stays-in-view). The column keeps its width in every mode, so
// opening a panel never changes the stage beside it. The chat stays mounted while hidden, so a
// reply that is streaming or a draft that was typed survives a look at a key.
export function SidePanel({ mode, summary, key_, chat, repeat }: Props) {
  return (
    <aside className="side" data-mode={mode} aria-label="Side panel">
      <div className="side-pane" hidden={mode !== "summary"}>{summary}</div>
      <div className="side-pane" hidden={mode !== "key"}>{key_}</div>
      <div id="side-chat" className="side-pane" hidden={mode !== "chat"}>{chat}</div>
      <div className="side-pane" hidden={mode !== "repeat"}>{repeat}</div>
    </aside>
  );
}
