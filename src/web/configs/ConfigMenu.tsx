import { Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, FileUp, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import type { ApiConfig } from "../../api/configs.ts";
import { formatWhen } from "../history/words.ts";
import { Menu } from "../shell/Menu.tsx";
import "./configs.css";

interface Props {
  live: readonly ApiConfig[];
  archived: readonly ApiConfig[];
  /** The config on screen, and its name for before the list arrives. */
  selectedId: string;
  selectedName: string;
  /** "Moonlander", for "On your Moonlander". */
  boardName: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: () => void;
  onArchive: () => void;
  onRestore: (id: string) => void;
  onImport: () => void;
}

/** Where a config came from and when it was last edited, under its name; the one on the keyboard says only that. */
export function configLine(config: ApiConfig, now: number): string {
  const when = formatWhen(config.updatedAt, now).replace(/^(Today|Yesterday|Just now)/, (w) => w.toLowerCase());
  return config.copiedFrom === null ? `Edited ${when}` : `Copied from ${config.copiedFrom.layoutName ?? "a deleted config"} · edited ${when}`;
}

// The config switcher (D-315): the caption's layout menu, now this board's configs only (other boards are in the top bar's board
// switch). The one on the keyboard is marked green; New, Rename, Archive and the archived ones follow, then Import.
export function ConfigMenu({ live, archived, selectedId, selectedName, boardName, onSelect, onNew, onRename, onArchive, onRestore, onImport }: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const now = Date.now();
  const selected = live.find((c) => c.id === selectedId);
  // The one on the keyboard first, then the rest newest edited first (the API's order).
  const ordered = [...live.filter((c) => c.onKeyboard), ...live.filter((c) => !c.onKeyboard)];
  const onKeyboard = selected?.onKeyboard === true;
  return (
    <Menu
      label="Choose a config"
      triggerClassName="layout-trigger"
      trigger={
        <>
          <span className="layout-trigger-name">{selected?.name ?? selectedName}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <div className="config-menu">
          <div role="group" aria-label={`${boardName} configs`} className="menu-group">
            <p className="menu-heading" aria-hidden="true">{boardName} configs</p>
            {ordered.map((config) => (
              <button
                key={config.id}
                type="button"
                role="menuitemradio"
                aria-checked={config.id === selectedId}
                className="menu-item config-item"
                data-on-keyboard={config.onKeyboard || undefined}
                onClick={() => {
                  close();
                  if (config.id !== selectedId) onSelect(config.id);
                }}
              >
                <span className="menu-item-label">
                  {config.name}
                  {config.onKeyboard ? (
                    <span className="config-sub config-on"><i aria-hidden="true" />On your {boardName}</span>
                  ) : (
                    <span className="config-sub">{configLine(config, now)}</span>
                  )}
                </span>
                {config.id === selectedId ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          <div className="menu-separator" role="separator" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); onNew(); }}>
            <Plus size={14} aria-hidden="true" />
            <span className="menu-item-label">New config…</span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); onRename(); }}>
            <Pencil size={14} aria-hidden="true" />
            <span className="menu-item-label">Rename {selected?.name ?? selectedName}…</span>
          </button>
          {/* The config on the keyboard can't be archived (the API refuses it); the item says why instead of failing. */}
          <button type="button" role="menuitem" className="menu-item" disabled={onKeyboard} onClick={() => { close(); onArchive(); }}>
            <Archive size={14} aria-hidden="true" />
            <span className="menu-item-label">
              Archive {selected?.name ?? selectedName}
              {onKeyboard ? <span className="config-sub">Put another on your {boardName} first</span> : null}
            </span>
          </button>
          {archived.length === 0 ? null : (
            <>
              <button type="button" role="menuitem" className="menu-item" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                <span className="menu-item-label">Archived ({archived.length})</span>
              </button>
              {showArchived
                ? archived.map((config) => (
                    <button key={config.id} type="button" role="menuitem" className="menu-item config-archived" onClick={() => { close(); onRestore(config.id); }}>
                      <ArchiveRestore size={14} aria-hidden="true" />
                      <span className="menu-item-label">
                        Restore {config.name}
                        <span className="config-sub">Archived {formatWhen(config.archivedAt ?? config.updatedAt, now).toLowerCase()}</span>
                      </span>
                    </button>
                  ))
                : null}
            </>
          )}
          <div className="menu-separator" role="separator" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); onImport(); }}>
            <FileUp size={14} aria-hidden="true" />
            <span className="menu-item-label">Import a layout…</span>
          </button>
        </div>
      )}
    </Menu>
  );
}
