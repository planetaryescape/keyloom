import { Ellipsis, Hammer, Keyboard, Monitor, Moon, Sun, ChevronDown, Check, FileUp } from "lucide-react";
import type { LayoutSummary } from "../../api/http.ts";
import type { ReleaseStatus } from "../release/status.ts";
import { SyncStatus } from "../sync/SyncStatus.tsx";
import type { SyncApi } from "../sync/useSync.ts";
import { Menu } from "./Menu.tsx";
import { useTheme, type ThemeChoice } from "./theme.ts";

/** "zsa/moonlander" is "Moonlander"; the vendor is in the layout summary, and a menu group needs only the board. */
export function boardTitle(boardId: string): string {
  const name = boardId.split("/").at(-1) ?? boardId;
  return name.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

interface LayoutMenuProps {
  layouts: readonly LayoutSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
  onImport: () => void;
}

// Layouts grouped by the board they are for, in the order the boards first appear.
function LayoutMenu({ layouts, selectedId, onSelect, onImport }: LayoutMenuProps) {
  const selected = layouts.find((layout) => layout.id === selectedId);
  const groups = new Map<string, LayoutSummary[]>();
  for (const layout of layouts) groups.set(layout.boardId, [...(groups.get(layout.boardId) ?? []), layout]);
  return (
    <Menu
      label="Choose a layout"
      triggerClassName="layout-trigger"
      trigger={
        <>
          <span className="layout-trigger-board">{selected === undefined ? "" : boardTitle(selected.boardId)}</span>
          <span className="layout-trigger-name">{selected?.name ?? "Layout"}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <>
          {[...groups].map(([boardId, group]) => (
            <div key={boardId} role="group" aria-label={boardTitle(boardId)} className="menu-group">
              <p className="menu-heading" aria-hidden="true">{boardTitle(boardId)}</p>
              {group.map((layout) => (
                <button
                  key={layout.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={layout.id === selectedId}
                  className="menu-item"
                  onClick={() => {
                    onSelect(layout.id);
                    close();
                  }}
                >
                  <span className="menu-item-label">{layout.name}</span>
                  {layout.id === selectedId ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ))}
          <div className="menu-separator" role="separator" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); onImport(); }}>
            <FileUp size={14} aria-hidden="true" />
            <span className="menu-item-label">Import a layout…</span>
          </button>
        </>
      )}
    </Menu>
  );
}

const THEMES: readonly { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "auto", label: "Match system", icon: Monitor },
];

function ThemeToggle({ value, onChange }: { value: ThemeChoice; onChange: (value: ThemeChoice) => void }) {
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ value: choice, label, icon: Icon }) => (
        <button key={choice} type="button" role="radio" aria-checked={value === choice} aria-label={label} title={label} onClick={() => onChange(choice)}>
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function ReleaseMenu({ status, onOpen }: { status: ReleaseStatus; onOpen: () => void }) {
  return (
    <div className="release-menu">
      {status.tone === "idle" ? null : (
        <span className="release-status" data-tone={status.tone} role="status">{status.label}</span>
      )}
      <Menu label="Build and flash" align="end" trigger={<Ellipsis size={18} aria-hidden="true" />} triggerClassName="icon-button">
        {(close) => (
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              onOpen();
            }}
          >
            <Hammer size={14} aria-hidden="true" />
            <span className="menu-item-label">Build and flash…</span>
          </button>
        )}
      </Menu>
    </div>
  );
}

export interface HeaderProps {
  layouts?: readonly LayoutSummary[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onImport?: () => void;
  release?: { status: ReleaseStatus; onOpen: () => void };
  /** The keyboard's sync state for the layout on screen (17). */
  sync?: { api: SyncApi; layoutId: string; boardId: string; onOpenRelease: () => void };
}

// The header carries identity and state: which board and layout, the theme, and the way to build.
// Everything else about the layout lives in the summary panel.
export function Header({ layouts, selectedId, onSelect, onImport, release, sync }: HeaderProps) {
  const [theme, setTheme] = useTheme();
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Keyboard size={16} />
        </span>
        <span className="brand-name">keyloom</span>
      </div>
      {layouts === undefined || selectedId === undefined || onSelect === undefined || onImport === undefined ? null : (
        <LayoutMenu layouts={layouts} selectedId={selectedId} onSelect={onSelect} onImport={onImport} />
      )}
      <div className="header-end">
        {sync === undefined ? null : <SyncStatus sync={sync.api} layoutId={sync.layoutId} boardId={sync.boardId} onOpenRelease={sync.onOpenRelease} />}
        <ThemeToggle value={theme} onChange={setTheme} />
        {release === undefined ? null : <ReleaseMenu status={release.status} onOpen={release.onOpen} />}
      </div>
    </header>
  );
}
