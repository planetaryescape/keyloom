import { CircleAlert, CircleCheck, Hammer, KeyboardOff, LoaderCircle, Pause, Play, RefreshCw, TriangleAlert, Unplug, Zap } from "lucide-react";
import type { BoardSync } from "../../api/http.ts";
import { Menu } from "../shell/Menu.tsx";
import type { SyncApi } from "./useSync.ts";
import { autoSyncLine, syncLine, type SyncLine, type SyncTone } from "./words.ts";
import "./sync.css";

const ICON = {
  success: CircleCheck, busy: LoaderCircle, neutral: RefreshCw, warning: TriangleAlert, error: CircleAlert,
} satisfies Record<SyncTone, typeof CircleCheck>;

function icon(board: BoardSync, line: SyncLine) {
  if (board.state.kind === "not_connected") return Unplug;
  if (board.state.kind === "behind" && board.state.why === "remapping_off") return KeyboardOff;
  if (board.state.kind === "needs_hand") return Zap;
  return ICON[line.tone];
}

interface PillProps {
  board: BoardSync;
  line: SyncLine;
  selected: boolean;
  sync: SyncApi;
  /** The layout on screen, which "Sync now" puts on the keyboard. */
  layoutId: string;
  onOpenRelease: () => void;
}

// One keyboard: a pill with its state, and a menu with the reason, what to do about it, and the auto-sync switch (17).
function BoardPill({ board, line, selected, sync, layoutId, onOpenRelease }: PillProps) {
  const Icon = icon(board, line);
  const auto = autoSyncLine(board);
  // Sync now acts on the layout on screen when this is its board, and on the layout the keyboard is tracked against otherwise.
  const act = (id: "sync_now" | "flash_keyloom") => (id === "flash_keyloom" ? onOpenRelease() : void sync.syncNow(selected ? layoutId : board.layoutId));
  return (
    <div className="sync-pill-group" data-selected={selected}>
      <Menu
        label={`${board.boardName} sync: ${line.label}`}
        align="end"
        triggerClassName="sync-pill"
        trigger={
          <span className="sync-pill-body" data-tone={line.tone}>
            <i className="sync-light" data-tone={lightFor(board, line)} aria-hidden="true" />
            <Icon size={14} className="sync-icon" aria-hidden="true" />
            <span className="sync-label">{line.label}</span>
            <span className="sync-short">{line.short}</span>
          </span>
        }
      >
        {(close) => (
          <>
            {/* The sync sheet (P4): the state in words with its light, why, and the one thing to do as the only filled button. */}
            <div className="sync-detail">
              <span className="sync-detail-board">{board.boardName}</span>
              <span className="sync-detail-state">
                <i className="sync-light" data-tone={lightFor(board, line)} aria-hidden="true" />
                {line.label}
              </span>
              {line.detail === null ? null : <span className="sync-detail-why">{line.detail}</span>}
            </div>
            {line.action === null ? null : (
              <button type="button" role="menuitem" className="menu-item sync-primary" onClick={() => { close(); act(line.action!.id); }}>
                <RefreshCw size={14} aria-hidden="true" />
                <span className="menu-item-label">{line.action.label}</span>
              </button>
            )}
            {board.auto.proven ? (
              <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); void sync.setPaused(board.boardId, !board.auto.paused); }}>
                {board.auto.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                <span className="menu-item-label">{board.auto.paused ? "Resume auto-sync" : "Pause auto-sync"}</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              aria-label={`Auto-sync ${auto.on ? "is on. Turn it off" : board.auto.paused ? "is paused. Turn it off" : "is off. Turn it on"}`}
              className="menu-item"
              disabled={!auto.canTurnOn && !auto.on}
              onClick={() => { close(); void sync.setAuto(board.boardId, !(board.auto.choice ?? board.auto.proven)); }}
            >
              <span className="menu-item-label">Auto-sync {auto.on ? "is on" : board.auto.paused ? "is paused" : "is off"}</span>
              <span className="sync-switch" data-on={auto.on} aria-hidden="true" />
            </button>
            {auto.note === null ? null : <p className="sync-note">{auto.note}</p>}
            <div className="menu-separator" role="separator" />
            {board.remapper === true ? (
              // Reloads the identity map, so the MacBook types plainly again. Needs no sudo.
              board.state.kind === "behind" && board.state.why === "remapping_off" ? null : (
                <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); void sync.disableRemapping(board.boardId); }}>
                  <KeyboardOff size={14} aria-hidden="true" />
                  <span className="menu-item-label">Disable remapping</span>
                </button>
              )
            ) : (
              <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); onOpenRelease(); }}>
                <Hammer size={14} aria-hidden="true" />
                <span className="menu-item-label">Build and flash…</span>
              </button>
            )}
          </>
        )}
      </Menu>
      {line.action === null || board.state.kind === "needs_hand" ? null : (
        <button type="button" className="sync-action" onClick={() => act(line.action!.id)}>
          {line.action.label}
        </button>
      )}
    </div>
  );
}

interface Props {
  sync: SyncApi;
  /** The layout on screen and its board. */
  layoutId: string;
  boardId: string;
  onOpenRelease: () => void;
}

/**
 * The keyboard's state as one light (D-263): green when it has the latest change, amber while a change waits or is on its way, red when
 * it needs a hand or the last sync failed, and off when it isn't connected.
 */
export function lightFor(board: BoardSync, line: SyncLine): "ok" | "pending" | "bad" | "off" {
  if (line.tone === "error" || line.tone === "warning") return "bad";
  switch (board.state.kind) {
    case "in_sync": return line.tone === "success" ? "ok" : "pending";
    case "syncing":
    case "behind": return "pending";
    // Unplugged with changes waiting is still a change not on the keyboard: amber, not off.
    case "not_connected": return board.state.changes != null && board.state.changes > 0 ? "pending" : "off";
    default: return "bad";
  }
}

/** The light a board shows in the board switcher, or null when its keyboard isn't connected. */
export function boardLight(board: BoardSync | undefined): "ok" | "pending" | "bad" | null {
  if (board === undefined) return null;
  const tone = lightFor(board, syncLine(board, null));
  return tone === "off" ? null : tone;
}

// One quiet line for the keyboard of the layout on screen (23#chrome-recedes). It opens to say why, what to do, and auto-sync.
// Other connected keyboards show their light on their silhouette in the board switcher.
export function SyncStatus({ sync, layoutId, boardId, onOpenRelease }: Props) {
  const shown = sync.boards.filter((b) => b.boardId === boardId);
  if (shown.length === 0) return null;
  return (
    <div className="sync-status">
      {/* The pill is a button, so the change of state is announced from here. */}
      <p className="sr-only" role="status">
        {(() => {
          const mine = shown.find((b) => b.boardId === boardId);
          return mine === undefined ? "" : `${mine.boardName}: ${syncLine(mine, layoutId).label}`;
        })()}
      </p>
      {shown.map((board) => (
        <BoardPill
          key={board.boardId}
          board={board}
          line={syncLine(board, board.boardId === boardId ? layoutId : null)}
          selected={board.boardId === boardId}
          sync={sync}
          layoutId={layoutId}
          onOpenRelease={onOpenRelease}
        />
      ))}
    </div>
  );
}
