import { Activity, Check, ChevronDown, CircleHelp, Code, Ellipsis, Eye, Hammer, History, Keyboard as KeyboardIcon, Library, ListTree, LoaderCircle, Monitor, Moon, MousePointer2, Redo2, Search, SlidersHorizontal, Spline, Sun, SunMoon, Undo2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { PHONE, useMediaQuery } from "./useMediaQuery.ts";
import type { BoardChoice } from "../../api/http.ts";
import type { GeometryKey } from "../../boards/schema.ts";
import { applyDisplayRotation, boardBounds } from "../keyboard/geometry.ts";
import type { ReleaseStatus } from "../release/status.ts";
import { Menu } from "./Menu.tsx";
import { useTheme, type ThemeChoice } from "./theme.ts";
import "./topbar.css";

/** A board in the switcher: one the person has a layout for, and the tone of its keyboard's light if it is connected. */
export interface BoardEntry {
  id: string;
  name: string;
  board?: BoardChoice;
  /** The keyboard's state as a light: "ok", "pending", "bad", or null when it isn't connected. */
  tone?: "ok" | "pending" | "bad" | null;
}

/** Everything the menu can open. Each is absent where the page can't do it (an import screen has no history). */
export interface MenuActions {
  history?: { open: boolean; onToggle: () => void };
  library?: { open: boolean; onToggle: () => void };
  combos?: { open: boolean; onToggle: () => void };
  settings?: { open: boolean; onToggle: () => void };
  /** The typing lab (D-314). */
  lab?: { open: boolean; onToggle: () => void };
  advanced?: { on: boolean; onToggle: () => void };
  /** Taps select keys instead of opening them, for screens without a Shift key. */
  select?: { on: boolean; onToggle: () => void };
  /** Inspect: kinds, pass-through legends and combos on the board (⌥I). */
  inspect?: { on: boolean; onToggle: () => void };
  /** Combos drawn on the board, for the phone's menu (D-311). */
  showCombos?: { on: boolean; onToggle: () => void };
  onShortcuts?: () => void;
  release?: { status: ReleaseStatus; onOpen: () => void };
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  /** Why undo is off right now (a key's draft is open), said in the button's title. */
  blockedReason: string | null;
  /** What undo would take back. */
  summary: string;
  onUndo: () => void;
}

interface TopBarProps {
  boards?: { entries: readonly BoardEntry[]; active: string | null; onSelect: (boardId: string) => void };
  /** The sync line, centred. */
  sync?: ReactNode;
  ask?: { open: boolean; onToggle: () => void };
  undo?: UndoState;
  menu?: MenuActions;
}

// A board's keys as a small solid shape: enough to tell a Moonlander from a Glove80 at a glance (D-269).
export function Silhouette({ keys, display, width = 30, height = 14 }: { keys: readonly GeometryKey[]; display?: BoardChoice["display"]; width?: number; height?: number }) {
  const rotated = useMemo(() => {
    try {
      return applyDisplayRotation(keys, display);
    } catch {
      return keys;
    }
  }, [keys, display]);
  if (rotated.length === 0) return <KeyboardIcon size={16} aria-hidden="true" />;
  const b = boardBounds(rotated);
  const pad = 0.15;
  return (
    <svg className="silhouette" viewBox={`${b.minX - pad} ${b.minY - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`} width={width} height={height} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {rotated.map((key, i) => (
        <rect key={i} x={key.x + 0.1} y={key.y + 0.1} width={key.w - 0.2} height={key.h - 0.2} rx={0.2} transform={key.r === 0 ? undefined : `rotate(${key.r} ${key.rx} ${key.ry})`} />
      ))}
    </svg>
  );
}

const THEMES: readonly { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "auto", label: "Match system", icon: Monitor },
];

// The top bar (23#chrome-recedes): which board, one line of state, and the few things used often. Everything else is in the menu.
export function TopBar({ boards, sync, ask, undo, menu }: TopBarProps) {
  const [theme, setTheme] = useTheme();
  // A phone keeps the board menu, the sync light, Ask and the menu; undo, redo and the theme move into the menu (P1 review).
  const phone = useMediaQuery(PHONE);
  const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <header className="topbar">
      <div className="topbar-start">
        <span className="topbar-word">keyloom</span>
        {boards === undefined || boards.entries.length === 0 ? null : phone ? <BoardMenu {...boards} /> : (
          <nav className="board-switch" aria-label="Boards">
            {boards.entries.map((entry) => {
              const on = entry.id === boards.active;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="board-switch-item"
                  aria-current={on ? "page" : undefined}
                  title={entry.name}
                  aria-label={entry.name}
                  onClick={() => boards.onSelect(entry.id)}
                >
                  <BoardMark entry={entry} />
                  {on ? <span className="board-switch-name">{entry.name}</span> : null}
                  {entry.tone === null || entry.tone === undefined || on ? null : <i className="board-switch-light" data-tone={entry.tone} aria-hidden="true" />}
                </button>
              );
            })}
          </nav>
        )}
      </div>
      <div className="topbar-middle">{sync}</div>
      <div className="topbar-end">
        {menu?.release === undefined || menu.release.status.tone === "idle" ? null : (
          <button type="button" className="topbar-release" data-tone={menu.release.status.tone} onClick={menu.release.onOpen}>
            {menu.release.status.label}
          </button>
        )}
        {ask === undefined ? null : (
          <button type="button" className="topbar-ask" aria-pressed={ask.open} onClick={ask.onToggle}>
            <Search size={15} aria-hidden="true" />
            <span className="topbar-ask-text">Ask keyloom</span>
            <kbd>⌘K</kbd>
          </button>
        )}
        {undo === undefined || phone ? null : <UndoButtons {...undo} />}
        {phone ? null : (
          <button type="button" className="topbar-icon" aria-label={dark ? "Use the light theme" : "Use the dark theme"} title="Light or dark" onClick={() => setTheme(dark ? "light" : "dark")}>
            <SunMoon size={17} aria-hidden="true" />
          </button>
        )}
        <Menu label="More" align="end" triggerClassName="topbar-icon" trigger={<Ellipsis size={18} aria-hidden="true" />}>
          {(close) => (
            <>
              {undo === undefined ? null : (
                <>
                  {phone ? <Item icon={Undo2} label="Undo" hint="⌘Z" disabled={!undo.canUndo || undo.busy || undo.blockedReason !== null} onSelect={() => { close(); undo.onUndo(); }} /> : null}
                  <Item icon={Redo2} label="Redo" hint="⇧⌘Z" disabled={!undo.canRedo || undo.busy || undo.blockedReason !== null} onSelect={() => { close(); undo.onUndo(); }} />
                  <div className="menu-separator" role="separator" />
                </>
              )}
              {/* Combos, Inspect, History and Library sit beside the strip on a wide screen (D-311); a phone keeps them here. */}
              {!phone || menu?.showCombos === undefined ? null : <Item icon={Spline} label="Combos on the board" hint="⌥C" checked={menu.showCombos.on} role="menuitemcheckbox" onSelect={() => { close(); menu.showCombos?.onToggle(); }} />}
              {!phone || menu?.inspect === undefined ? null : <Item icon={Eye} label="Inspect" hint="⌥I" checked={menu.inspect.on} role="menuitemcheckbox" onSelect={() => { close(); menu.inspect?.onToggle(); }} />}
              {!phone || menu?.history === undefined ? null : <Item icon={History} label="History" hint="⌥H" checked={menu.history.open} onSelect={() => { close(); menu.history?.onToggle(); }} />}
              {!phone || menu?.library === undefined ? null : <Item icon={Library} label="Library" hint="⌥L" checked={menu.library.open} onSelect={() => { close(); menu.library?.onToggle(); }} />}
              {menu?.combos === undefined ? null : <Item icon={ListTree} label="All combos" checked={menu.combos.open} onSelect={() => { close(); menu.combos?.onToggle(); }} />}
              {menu?.lab === undefined ? null : <Item icon={Activity} label="Typing lab" checked={menu.lab.open} onSelect={() => { close(); menu.lab?.onToggle(); }} />}
              {menu?.settings === undefined ? null : <Item icon={SlidersHorizontal} label="Settings" checked={menu.settings.open} onSelect={() => { close(); menu.settings?.onToggle(); }} />}
              {menu?.release === undefined ? null : (
                <>
                  <div className="menu-separator" role="separator" />
                  <Item icon={Hammer} label="Build and flash…" onSelect={() => { close(); menu.release?.onOpen(); }} />
                </>
              )}
              {menu?.advanced === undefined && menu?.onShortcuts === undefined ? null : <div className="menu-separator" role="separator" />}
              {menu?.select === undefined ? null : <Item icon={MousePointer2} label="Select several keys" checked={menu.select.on} role="menuitemcheckbox" onSelect={() => { close(); menu.select?.onToggle(); }} />}
              {menu?.advanced === undefined ? null : <Item icon={Code} label="Advanced view: firmware names" checked={menu.advanced.on} role="menuitemcheckbox" onSelect={() => { close(); menu.advanced?.onToggle(); }} />}
              {menu?.onShortcuts === undefined ? null : <Item icon={CircleHelp} label="Keyboard shortcuts" hint="?" onSelect={() => { close(); menu.onShortcuts?.(); }} />}
              <div className="menu-separator" role="separator" />
              <div role="group" aria-label="Theme">
                {THEMES.map(({ value, label, icon }) => (
                  <Item key={value} icon={icon} label={label} checked={theme === value} role="menuitemradio" onSelect={() => { close(); setTheme(value); }} />
                ))}
              </div>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

function Item({ icon: Icon, label, hint, checked, disabled = false, role = "menuitem", onSelect }: { icon: typeof Sun; label: string; hint?: string; checked?: boolean; disabled?: boolean; role?: "menuitem" | "menuitemradio" | "menuitemcheckbox"; onSelect: () => void }) {
  return (
    <button type="button" role={role} aria-checked={role === "menuitem" ? undefined : checked === true} className="menu-item" disabled={disabled} onClick={onSelect}>
      <Icon size={14} aria-hidden="true" />
      <span className="menu-item-label">{label}</span>
      {hint === undefined ? null : <kbd className="menu-hint">{hint}</kbd>}
      {checked === true ? <Check size={14} aria-hidden="true" /> : null}
    </button>
  );
}

// One undo arrow, the same on every board and in every state (P1 review). Redo is ⇧⌘Z and an item in the menu: an undo is itself a
// revision, so redo puts back the change the last undo took away.
function UndoButtons({ canUndo, canRedo, busy, blockedReason, summary, onUndo }: UndoState) {
  const blocked = busy || blockedReason !== null;
  return (
    <>
      <button type="button" className="topbar-icon" aria-label="Undo" title={blockedReason ?? (canUndo ? `Undo: ${summary} (⌘Z)` : "Nothing to undo")} disabled={!canUndo || blocked} onClick={onUndo}>
        {busy ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <Undo2 size={17} aria-hidden="true" />}
      </button>
    </>
  );
}

function BoardMark({ entry }: { entry: BoardEntry }) {
  return entry.board?.keys === undefined ? <KeyboardIcon size={16} aria-hidden="true" /> : <Silhouette keys={entry.board.keys} display={entry.board.display} />;
}

// On a phone the switcher is one button, the board on screen, that opens the list of boards.
function BoardMenu({ entries, active, onSelect }: NonNullable<TopBarProps["boards"]>) {
  const current = entries.find((entry) => entry.id === active) ?? entries[0];
  if (current === undefined) return null;
  return (
    <Menu
      label="Choose a board"
      triggerClassName="board-switch-item board-menu-trigger"
      trigger={
        <>
          <BoardMark entry={current} />
          <span className="board-switch-name">{current.name}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>
      }
    >
      {(close) =>
        entries.map((entry) => (
          <button key={entry.id} type="button" role="menuitemradio" aria-checked={entry.id === active} className="menu-item" onClick={() => { close(); onSelect(entry.id); }}>
            <BoardMark entry={entry} />
            <span className="menu-item-label">{entry.name}</span>
            {entry.id === active ? <Check size={14} aria-hidden="true" /> : null}
          </button>
        ))
      }
    </Menu>
  );
}
