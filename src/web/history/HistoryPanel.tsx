import { ArrowLeftRight, ArrowRight, ChevronDown, ChevronRight, Copy, GitCompare, Keyboard, LoaderCircle, Pencil, RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";
import type { VersionHistoryResponse } from "../../api/configs.ts";
import type { Layout } from "../../layout/schema.ts";
import { MiniCap, SheetHead } from "../shell/Sheet.tsx";
import { historyWords } from "./history-words.ts";
import type { Versions } from "./useVersions.ts";
import { changes, versionTitle, versionWhen } from "./version-words.ts";
import { formatWhen, sourceLabel } from "./words.ts";
import "./history.css";

type Brief = VersionHistoryResponse["pending"][number];
export type Milestone = VersionHistoryResponse["versions"][number];

interface Props {
  versions: Versions;
  /** The layout on screen, so an old row's key can be drawn as the cap it is now. */
  layout: Pick<Layout, "layers" | "macros" | "tapDances">;
  configName: string;
  boardName: string;
  /** This config is the one on the keyboard, so changes newer than its last version are waiting to go on. */
  onKeyboard: boolean;
  onClose: () => void;
  onReload: () => void;
  /** Goes back to a revision as one new revision. Resolves once the page shows it. */
  onGoBack: (revision: { id: string; summary: string }) => Promise<void>;
  onCompare: (milestone: Milestone) => void;
  onPutOn: (milestone: Milestone) => void;
  onNewConfig: (milestone: Milestone) => void;
  onName: (milestone: Milestone, name: string) => Promise<void>;
  /** Why going back isn't possible right now, shown under the title; null when it is. */
  blockedReason: string | null;
}

// History as versions (D-315, 25): what isn't on the keyboard yet, then each version that went on it, newest first, with the changes
// made while it was there folded under it. Every revision is still here, so going back to any of them works as before (D-102).
export function HistoryPanel(props: Props) {
  const { versions, configName, boardName, onClose, onReload, blockedReason } = props;
  return (
    <section className="history-panel" aria-label="History">
      <SheetHead
        title="History"
        lead={`${configName}, newest first. A version is what was on your ${boardName}; the changes made while it was there fold under it.`}
        closeLabel="Close the history"
        onClose={onClose}
      />
      {blockedReason === null ? null : <p className="sheet-note" role="status">{blockedReason}</p>}
      <div className="sheet-body">
        {versions.status === "idle" || versions.status === "loading" ? (
          <p className="sheet-empty" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Loading the history…</p>
        ) : versions.status === "error" ? (
          <div className="sheet-empty" role="alert">
            <p>{versions.message}</p>
            <button type="button" className="sheet-action" onClick={onReload}><RefreshCw size={14} aria-hidden="true" />Try again</button>
          </div>
        ) : (
          <Timeline {...props} history={versions.history} />
        )}
      </div>
    </section>
  );
}

function Timeline({ history, layout, boardName, onKeyboard, onGoBack, onCompare, onPutOn, onNewConfig, onName, blockedReason }: Props & { history: VersionHistoryResponse }) {
  const now = Date.now();
  const [working, setWorking] = useState<string | null>(null);
  // The current version's changes show; older ones fold until asked.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(history.versions.filter((m) => m.version.current).map((m) => m.version.id)));
  const [naming, setNaming] = useState<string | null>(null);

  async function goBack(revision: { id: string; summary: string }) {
    setWorking(revision.id);
    try {
      await onGoBack(revision);
    } finally {
      setWorking(null);
    }
  }
  const row = (revision: Brief, folded: boolean) => (
    <RevisionRow
      key={revision.id}
      revision={revision}
      layout={layout}
      head={revision.id === history.headRevisionId}
      folded={folded}
      now={now}
      busy={working === revision.id}
      disabled={blockedReason !== null || working !== null}
      onGoBack={() => void goBack(revision)}
    />
  );

  const neverOn = history.versions.length === 0;
  return (
    <>
      {history.pending.length === 0 ? null : (
        <>
          {/* Amber only when this config is the keyboard's: on another config, newer changes aren't waiting for anything. */}
          {neverOn ? null : onKeyboard ? (
            <p className="history-pending"><i aria-hidden="true" />Not on your {boardName} yet · {changes(history.pending.length)}</p>
          ) : (
            <p className="history-group">Since it was last on your {boardName} · {changes(history.pending.length)}</p>
          )}
          <ol className="sheet-rows" aria-label={neverOn ? "Revisions" : "Changes not on the keyboard"}>{history.pending.map((r) => row(r, false))}</ol>
        </>
      )}
      {neverOn ? null : (
        <ol className="sheet-rows history-rail" aria-label="Versions">
          {history.versions.map((milestone) => {
            const v = milestone.version;
            const isOpen = open.has(v.id);
            const atHead = v.revisionId === history.headRevisionId;
            return (
              <li key={v.id} className="sheet-row history-version" data-current={v.current || undefined}>
                <div className="sheet-row-main">
                  {naming === v.id ? (
                    <NameField
                      initial={v.name ?? ""}
                      onCancel={() => setNaming(null)}
                      onSave={async (name) => {
                        await onName(milestone, name);
                        setNaming(null);
                      }}
                    />
                  ) : (
                    <p className="sheet-row-title">
                      <span className={v.name === null ? "history-unnamed" : "history-name"}>{versionTitle(v)}</span>
                      <button type="button" className="history-inline" aria-label={v.name === null ? "Name this version" : `Rename ${v.name}`} onClick={() => setNaming(v.id)}>
                        <Pencil size={12} aria-hidden="true" />
                        {v.name === null ? "Name it" : null}
                      </button>
                    </p>
                  )}
                  {v.current ? <span className="sheet-pill history-on">On your {boardName}</span> : null}
                </div>
                <p className="sheet-row-meta">
                  <span>{versionWhen(v, now)}</span>
                  {milestone.revisions.length === 0 ? null : (
                    <>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        className="history-fold"
                        aria-expanded={isOpen}
                        onClick={() => setOpen((s) => {
                          const next = new Set(s);
                          if (next.has(v.id)) next.delete(v.id);
                          else next.add(v.id);
                          return next;
                        })}
                      >
                        {isOpen ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                        {changes(milestone.revisions.length)}
                      </button>
                    </>
                  )}
                </p>
                {/* An unnamed version is told by its last change; a named one by its name. */}
                {v.name === null ? <p className="history-version-what">{historyWords(v.summary, layout, "editor").text}</p> : null}
                <div className="sheet-row-actions history-version-actions">
                  {atHead ? null : (
                    <button type="button" className="sheet-action" onClick={() => onCompare(milestone)}>
                      <GitCompare size={13} aria-hidden="true" />Compare with now
                    </button>
                  )}
                  {atHead ? null : (
                    <button type="button" className="sheet-action" disabled={blockedReason !== null || working !== null} onClick={() => void goBack({ id: v.revisionId, summary: versionTitle(v) })}>
                      {working === v.revisionId ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}
                      Go back to this
                    </button>
                  )}
                  {/* The version on the keyboard with nothing newer is already there. */}
                  {v.current && atHead ? null : (
                    <button type="button" className="sheet-action" disabled={blockedReason !== null} onClick={() => onPutOn(milestone)}>
                      <Keyboard size={13} aria-hidden="true" />Put on keyboard
                    </button>
                  )}
                  <button type="button" className="sheet-action" onClick={() => onNewConfig(milestone)}>
                    <Copy size={13} aria-hidden="true" />New config from here
                  </button>
                </div>
                {isOpen && milestone.revisions.length > 0 ? <ol className="sheet-rows history-folded" aria-label={`Changes under ${versionTitle(v)}`}>{milestone.revisions.map((r) => row(r, true))}</ol> : null}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function RevisionRow({ revision, layout, head, folded, now, busy, disabled, onGoBack }: {
  revision: Brief;
  layout: Props["layout"];
  head: boolean;
  folded: boolean;
  now: number;
  busy: boolean;
  disabled: boolean;
  onGoBack: () => void;
}) {
  // Stored summaries are read into people's words here, old and new alike (D-279, D-312).
  const words = historyWords(revision.summary, layout, revision.origin);
  return (
    <li className="sheet-row revision" data-head={head} data-origin={revision.origin} data-folded={folded || undefined}>
      <div className="sheet-row-main">
        {/* The key, then what it became: "[4] → F17". */}
        {words.cap === null ? null : (
          <>
            <MiniCap>{words.cap}</MiniCap>
            <ArrowRight size={12} className="revision-arrow" aria-label="became" role="img" />
          </>
        )}
        {words.swap === undefined ? null : (
          <span className="mini-caps" aria-label={`Swapped ${words.swap[0]} and ${words.swap[1]}`}>
            <MiniCap>{words.swap[0]}</MiniCap>
            <ArrowLeftRight size={12} className="revision-arrow" aria-hidden="true" />
            <MiniCap>{words.swap[1]}</MiniCap>
          </span>
        )}
        {words.swap === undefined ? <p className="sheet-row-title revision-title" title={words.text}>{words.text}</p> : <span className="sheet-row-title" />}
        {head ? <span className="sheet-pill">On screen</span> : null}
      </div>
      <p className="sheet-row-meta">
        <span>{words.how ?? sourceLabel(revision.origin)}</span>
        {words.layer === null ? null : (
          <>
            <span aria-hidden="true">·</span>
            <span>{words.layer}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(revision.createdAt).toISOString()} title={new Date(revision.createdAt).toLocaleString()}>{formatWhen(revision.createdAt, now)}</time>
      </p>
      {head ? null : (
        <div className="sheet-row-actions">
          <button type="button" className="sheet-action" disabled={disabled} aria-label={`Go back to: ${words.text}`} onClick={onGoBack}>
            {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}
            Go back to this
          </button>
        </div>
      )}
    </li>
  );
}

function NameField({ initial, onSave, onCancel }: { initial: string; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      await onSave(name.trim());
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't name it.");
      setBusy(false);
    }
  };
  return (
    <form
      className="history-name-field"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        className="history-name-input"
        aria-label="Name this version"
        value={name}
        placeholder="Before the HRM tweak"
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="history-name-actions">
        <button type="button" className="sheet-action" onClick={onCancel}>Cancel</button>
        {/* An empty name takes the name away (the API's rule), so Save works on an empty field too. */}
        <button type="submit" className="bar-apply" disabled={busy || name.trim() === initial}>Save the name</button>
      </div>
      {problem === null ? null : <p className="config-problem" role="alert">{problem}</p>}
    </form>
  );
}

