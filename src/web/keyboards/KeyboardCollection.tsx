import { Download, Keyboard as KeyboardIcon, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CollectionResponseSchema, CollectionKeyboardSchema, type CollectionKeyboard } from "../../api/keyboards.ts";
import { SyncStatusResponseSchema, type BoardChoice } from "../../api/http.ts";
import { request, failure } from "../api-write.ts";
import { Silhouette } from "../shell/TopBar.tsx";
import "./collection.css";

const GUIDE = "https://github.com/planetaryescape/keyloom/blob/main/CONTRIBUTING.md";
const CONTRIBUTION_FILE = "keyloom-board-contribution.zip";

export function KeyboardCollection({ token, choices, active, onChanged, onClose, onAdd, initiallyRemoved = false }: {
  token: string; choices: readonly BoardChoice[]; active: string | null; onChanged: (layoutId?: string) => void; onClose: () => void; onAdd: () => void;
  initiallyRemoved?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<CollectionKeyboard[] | null>(null);
  const [query, setQuery] = useState("");
  const [removed, setRemoved] = useState(initiallyRemoved);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A problem carries its Try again: the action that failed, not a reload of the list (R3-23).
  const [problem, setProblemState] = useState<{ text: string; retry: () => void } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // A restored keyboard stays paused until the person resumes it (restoreKeyboard): the note offers that here (R4-13).
  // Kept with the note it belongs to, so a later note (a download) doesn't carry the button.
  const [resumable, setResumable] = useState<{ keyboard: CollectionKeyboard; note: string } | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await request("GET", "/api/keyboards/collection", token, CollectionResponseSchema, signal);
    if (!signal?.aborted) setItems(result.keyboards);
  }, [token]);
  const reload = useCallback(() => {
    setProblemState(null);
    void load().catch((error) => setProblemState({ text: error instanceof Error ? error.message : "Couldn't load keyboards.", retry: reload }));
  }, [load]);
  const setProblem = (text: string | null, retry: () => void = reload) => setProblemState(text === null ? null : { text, retry });
  useEffect(() => {
    dialog.current?.showModal();
    const abort = new AbortController();
    void load(abort.signal).catch((error) => { if (!abort.signal.aborted) setProblem(error instanceof Error ? error.message : "Couldn't load keyboards."); });
    return () => abort.abort();
    // setProblem is rebuilt each render; the load is what this effect follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  const resume = async (keyboard: CollectionKeyboard) => {
    setBusy(keyboard.boardId); setProblem(null);
    try {
      await request("POST", "/api/sync/pause", token, SyncStatusResponseSchema, undefined, { boardId: keyboard.boardId, paused: false });
      setResumable(null);
      setNote(`${keyboard.name} restored, and syncing is on again.`);
    } catch (error) { setProblem(error instanceof Error ? error.message : "Couldn't resume syncing.", () => void resume(keyboard)); }
    finally { setBusy(null); }
  };
  const change = async (keyboard: CollectionKeyboard, action: "remove" | "restore") => {
    setBusy(keyboard.boardId); setProblem(null); setNote(null); setResumable(null);
    try {
      const result = await request("POST", `/api/keyboards/${action}`, token, CollectionKeyboardSchema, undefined, { board: keyboard.boardId });
      setItems((current) => current?.map((item) => item.boardId === result.boardId ? result : item) ?? [result]);
      setConfirm(null);
      if (action === "restore") setRemoved(false);
      const said = action === "remove" ? `${keyboard.name} removed. Configs and history are kept under Removed.` : `${keyboard.name} restored. Syncing stays paused until you resume it.`;
      setNote(said);
      if (action === "restore") setResumable({ keyboard: result, note: said });
      onChanged();
      try { await load(); }
      catch { setProblem("The keyboard was updated, but the collection couldn't refresh. Try again to reload the list."); }
    } catch (error) { setProblem(error instanceof Error ? error.message : "That didn't work.", () => void change(keyboard, action)); }
    finally { setBusy(null); }
  };
  const download = async (keyboard: CollectionKeyboard) => {
    setBusy(keyboard.boardId); setProblem(null); setNote(null);
    try {
      const response = await fetch("/api/keyboards/contribute", { method: "POST", headers: { "x-keyloom-token": token, "content-type": "application/json" }, body: JSON.stringify({ board: keyboard.boardId }) });
      if (!response.ok) throw await failure(response);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = CONTRIBUTION_FILE; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      // The desktop app saves it to Downloads and shows it in Finder (desktop/tauri/src-tauri/src/external.rs), so the name finds it.
      setNote(`Downloaded ${CONTRIBUTION_FILE}: board data and CONTRIBUTION.md. No personal layouts are included. Nothing was published.`);
    } catch (error) { setProblem(error instanceof Error ? error.message : "Couldn't prepare the contribution.", () => void download(keyboard)); }
    finally { setBusy(null); }
  };
  const matches = (items ?? []).filter((k) => (k.removedAt !== null) === removed && `${k.name} ${k.boardId}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <dialog ref={dialog} className="keyboard-collection" aria-labelledby="keyboard-collection-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="collection-head"><div><h2 id="keyboard-collection-title">Your keyboards</h2><p>Switch, restore or stop managing a keyboard.</p></div><button className="sheet-close" type="button" aria-label="Close keyboards" onClick={onClose}><X size={16} /></button></header>
    <div className="collection-tools">
      <label className="keyboard-picker-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Find in your keyboards" placeholder="Name or maker" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="collection-tabs" role="group" aria-label="Keyboard collection">
        <button type="button" aria-pressed={!removed} onClick={() => { setRemoved(false); setConfirm(null); }}>In setup ({items?.filter((k) => k.removedAt === null).length ?? 0})</button>
        <button type="button" aria-pressed={removed} onClick={() => { setRemoved(true); setConfirm(null); }}>Removed ({items?.filter((k) => k.removedAt !== null).length ?? 0})</button>
      </div>
    </div>
    {problem ? <p role="alert" className="collection-message">{problem.text}<button type="button" className="sheet-action" disabled={busy !== null} onClick={problem.retry}>Try again</button></p> : null}
    {note ? <p role="status" className="collection-message">{note}{resumable === null || resumable.note !== note ? null : <button type="button" className="sheet-action" disabled={busy !== null} onClick={() => void resume(resumable.keyboard)}>Resume syncing</button>}</p> : null}
    <div className="collection-list">
      {items === null && !problem ? <p><LoaderCircle size={16} className="spin" /> Loading your keyboards…</p> : null}
      {items !== null && matches.length === 0 ? <p className="collection-empty">{query ? "No keyboards match your search." : removed ? "No removed keyboards. Removed keyboards stay here with their configs and history." : "No keyboards in your setup yet. Add one below, or restore one from Removed."}</p> : null}
      {matches.map((keyboard) => {
        const choice = choices.find((c) => c.id === keyboard.boardId);
        return <section className="collection-keyboard" key={keyboard.boardId} aria-label={keyboard.name}>
          <div className="collection-identity">{choice?.keys ? <Silhouette keys={choice.keys} display={choice.display} width={42} height={24} /> : <KeyboardIcon size={24} aria-hidden="true" />}<div><h3>{keyboard.name}</h3><p>{keyboard.configCount} config{keyboard.configCount === 1 ? "" : "s"} · {keyboard.modelled ? "Crafted case" : "Approximate case"}{keyboard.boardId === active ? " · Viewing" : ""}</p><small>{keyboard.boardId}</small></div></div>
          <div className="collection-actions">
            {removed ? <button type="button" className="sheet-action" disabled={busy !== null} onClick={() => void change(keyboard, "restore")}>Restore {keyboard.name}</button> : <>
              {keyboard.layoutId ? <button type="button" className="sheet-action" onClick={() => { onChanged(keyboard.layoutId ?? undefined); onClose(); }}>Open</button> : null}
              <button type="button" className="sheet-action" disabled={busy !== null} onClick={() => setConfirm(keyboard.boardId)}>Remove from setup…</button>
            </>}
            <button type="button" className="sheet-action" disabled={busy !== null} onClick={() => void download(keyboard)}><Download size={13} aria-hidden="true" />Prepare contribution</button>
          </div>
          {confirm === keyboard.boardId ? <div className="collection-confirm"><p>Remove {keyboard.name} from your setup? Automatic syncing stops. Every config and its history stays recoverable under Removed. This does not change the keyboard's firmware or disable running software remapping.</p><div><button type="button" className="sheet-action" disabled={busy !== null} onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="bar-apply" disabled={busy !== null} onClick={() => void change(keyboard, "remove")}>Remove keyboard</button></div></div> : null}
        </section>;
      })}
    </div>
    <footer className="collection-foot"><div><a href={GUIDE} target="_blank" rel="noopener">Share a keyboard with keyloom</a><p>Prepare contribution, beside a keyboard above, downloads it as a folder to send. The guide says what happens next.</p></div><button className="bar-apply" type="button" onClick={onAdd}><Plus size={14} aria-hidden="true" />Add keyboard</button></footer>
  </dialog>;
}
