// What the desktop app's menu-bar extra says (D-325). The wording is the header's (src/web/sync/words.ts), chosen here so the Tauri
// shell only displays strings and carries no product logic.
import type { BoardSync, MenuBar } from "../api/http.ts";
import { syncLine, syncNotice } from "../web/sync/words.ts";

// Which board decides the summary and the icon's title: the one asking for the most attention.
const ATTENTION: Record<BoardSync["state"]["kind"], number> = { needs_hand: 5, syncing: 4, behind: 3, not_keyloom: 2, not_connected: 1, in_sync: 0 };

// A keyboard that is unplugged with nothing waiting for it is not news.
const needsLooking = (b: BoardSync): boolean => b.state.kind !== "in_sync" && !(b.state.kind === "not_connected" && !(b.state.changes != null && b.state.changes > 0));

export function menuBar(boards: readonly BoardSync[], before: readonly BoardSync[] | undefined): MenuBar {
  if (boards.length === 0) return { summary: "No keyboards", title: null, lines: [], syncLayoutId: null, notices: [] };
  const lines = boards.map((b) => ({ boardId: b.boardId, text: syncLine(b, null).label }));
  const top = boards.filter(needsLooking).sort((a, b) => ATTENTION[b.state.kind] - ATTENTION[a.state.kind])[0];
  const target = boards.find((b) => syncLine(b, null).action?.id === "sync_now" && (b.state.kind === "behind" || b.state.kind === "needs_hand"));
  const notices = boards.flatMap((b) => {
    const notice = syncNotice(before?.find((p) => p.boardId === b.boardId), b);
    return notice === null ? [] : [{ title: notice.message, body: notice.detail ?? "" }];
  });
  return {
    summary: top ? syncLine(top, null).label : boards.length === 1 ? lines[0]!.text : "All keyboards are on their latest change",
    title: top ? syncLine(top, null).short : null,
    lines,
    syncLayoutId: target?.layoutId ?? null,
    notices,
  };
}
