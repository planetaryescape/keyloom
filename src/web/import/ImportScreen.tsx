import { ArrowLeft, Check, Copy, ExternalLink, FilePlus2, FileUp, Laptop, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { BoardChoice, ImportResponse } from "../../api/http.ts";
import { boardDisplayName, boardTitle } from "../shell/Header.tsx";
import { createConfig } from "../configs/api-configs.ts";
import { ApiError } from "../api.ts";
import { IMPORTED_UNREADABLE, fetchBoards, readKarabinerConfig, uploadLayout } from "./api-import.ts";
import { acceptsFile, guideFor, importCommand, offersStartBlank } from "./export-steps.ts";
import { Silhouette } from "../shell/TopBar.tsx";
import { ActivityChoices } from "../review/WorkloadTests.tsx";
import type { ReviewActivity } from "../../api/review.ts";
import "../review/review.css";
import "./import.css";

type Boards = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; boards: BoardChoice[] };

interface Props {
  token: string;
  /** Called once the server has saved the layout; the caller shows it. */
  onImported: (result: ImportResponse) => void;
  /** Called with a blank config's id once it is made, when there was nothing to import (R3-12); the caller opens it. */
  onStartedBlank: (layoutId: string) => void;
  /** Present when there are layouts to go back to; the first-run screen has none. */
  onBack?: (() => void) | undefined;
}

// What the app shows with no layouts, and from the layout menu's "Import a layout" (18#states): one card per board, each
// saying which file to export and taking it by drop, so no terminal is needed. The CLI command stays underneath.
export function ImportScreen({ token, onImported, onStartedBlank, onBack }: Props) {
  const [boards, setBoards] = useState<Boards>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [activities, setActivities] = useState<ReviewActivity[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setBoards({ status: "loading" });
    fetchBoards(token, controller.signal).then(
      (list) => setBoards({ status: "ready", boards: list }),
      (error: unknown) => {
        if (!controller.signal.aborted) setBoards({ status: "error", message: error instanceof Error ? error.message : "Couldn't load the boards." });
      },
    );
    return () => controller.abort();
  }, [token, attempt]);

  return (
    <section className="import-screen" aria-labelledby="import-title">
      {onBack === undefined ? null : (
        <button type="button" className="sheet-action import-back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to your layouts
        </button>
      )}
      <header className="import-intro">
        <h2 id="import-title">{onBack === undefined ? "Bring in your first layout" : "Import a layout"}</h2>
        <p>Export your layout from your keyboard's own editor and drop the file on its card. Every layer shows up here, and nothing reaches the keyboard until you apply a change.</p>
      </header>
      <div className="br-workloads">
        <ActivityChoices value={activities} onChange={setActivities} />
        <p className="muted">Optional: test short US-ANSI samples after import and independently check suggestions. Needs Docker, may download firmware, and can take several minutes. Tests never flash your keyboard.</p>
      </div>
      {boards.status === "loading" ? (
        <p className="loading" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Loading the boards…</p>
      ) : boards.status === "error" ? (
        <div className="import-error" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <p>{boards.message}</p>
          <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={14} aria-hidden="true" />Try again</button>
        </div>
      ) : (
        <ul className="board-cards" aria-label="Supported keyboards">
          {inOrder(boards.boards).map((board) => (
            <li key={board.id}>
              <BoardCard board={board} token={token} onImported={onImported} onStartedBlank={onStartedBlank} activities={activities} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The boards BK has, in the order the blueprint names them; any others follow by name.
const FIRST = ["zsa/moonlander", "moergo/glove80", "foostan/corne"];
function inOrder(boards: readonly BoardChoice[]): BoardChoice[] {
  const rank = (board: BoardChoice) => (FIRST.includes(board.id) ? FIRST.indexOf(board.id) : FIRST.length);
  return [...boards].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function BoardCard({ board, token, onImported, onStartedBlank, activities }: { board: BoardChoice; token: string; onImported: (result: ImportResponse) => void; onStartedBlank: (layoutId: string) => void; activities: ReviewActivity[] }) {
  const guide = guideFor(board);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Saved, but the answer couldn't be read: the page reloads to show it, and the card takes nothing more until then (R2-17).
  const [saved, setSaved] = useState(false);
  // This Mac has no Karabiner settings: nothing to import, so the card offers a blank config instead (R3-12).
  const [nothingToRead, setNothingToRead] = useState(false);
  const [copied, setCopied] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const command = importCommand(board, activities);

  async function take(files: FileList | readonly File[] | null) {
    const file = files?.[0];
    if (file === undefined || busy || saved) return;
    if (!acceptsFile(guide, file.name)) {
      setProblem(`${file.name} isn't a ${guide.accepts} file. ${guide.steps}`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      onImported(await uploadLayout(token, board.id, file, activities));
    } catch (error) {
      if (error instanceof ApiError && error.code === IMPORTED_UNREADABLE) setSaved(true);
      setProblem(error instanceof Error ? error.message : "The import didn't go through.");
    } finally {
      setBusy(false);
      // The same file can be chosen again after a fix.
      if (picker.current !== null) picker.current.value = "";
    }
  }

  // Karabiner keeps its settings in a hidden folder a file picker doesn't show, so the server reads them from their fixed place.
  async function readFromMac() {
    setBusy(true);
    setProblem(null);
    setNothingToRead(false);
    let file: File;
    try {
      file = await readKarabinerConfig(token);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "keyloom couldn't read Karabiner's settings.");
      setNothingToRead(error instanceof ApiError && offersStartBlank(error.code));
      return;
    } finally {
      setBusy(false);
    }
    await take([file]);
  }

  async function startBlank() {
    setBusy(true);
    setProblem(null);
    try {
      const config = await createConfig(token, { from: "blank", name: `${boardDisplayName(board.name)} daily`, board: board.id });
      onStartedBlank(config.id);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "keyloom couldn't start a blank config.");
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    // Clipboard access can be refused; the command stays selectable either way.
    navigator.clipboard.writeText(command).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );
  }

  return (
    // The whole card takes the drop (P4): the board is drawn as itself at the top, so the right card is found by its shape.
    <article
      className="board-card"
      aria-labelledby={titleId}
      data-over={over}
      data-busy={busy}
        onDragEnter={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void take(event.dataTransfer.files);
        }}
    >
      <div className="board-card-object" aria-hidden="true">
        {board.keys === undefined ? null : <Silhouette keys={board.keys} display={board.display} width={220} height={84} />}
      </div>
      <header>
        <h3 id={titleId}>{board.name}</h3>
        <p className="muted">{board.vendor} · {board.keyCount} keys</p>
      </header>
      <p className="board-card-steps">{guide.steps}</p>
      {guide.link === undefined && !guide.readFromMac ? null : (
        <div className="board-card-actions">
          {guide.link === undefined ? null : (
            <a className="sheet-action" href={guide.link.href} target="_blank" rel="noreferrer">
              <ExternalLink size={13} aria-hidden="true" />
              {guide.link.label}
            </a>
          )}
          {guide.readFromMac ? (
            <button type="button" className="sheet-action" disabled={busy || saved} onClick={() => void readFromMac()}>
              <Laptop size={13} aria-hidden="true" />
              Read it from this Mac
            </button>
          ) : null}
        </div>
      )}
      <div className="dropzone">
        {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />}
        <p>{busy ? "Importing…" : `Drop the ${guide.accepts} here, or`}</p>
        <button type="button" className="sheet-action dropzone-choose" disabled={busy || saved} onClick={() => picker.current?.click()}>
          choose it
        </button>
        <input
          ref={picker}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label={`${board.name} export file`}
          accept={guide.extensions.join(",")}
          onChange={(event) => void take(event.currentTarget.files)}
        />
      </div>
      {problem === null ? null : <p className="board-card-problem" role="alert"><TriangleAlert size={14} aria-hidden="true" />{problem}</p>}
      {nothingToRead ? (
        <button type="button" className="button button-primary board-card-reload" disabled={busy} onClick={() => void startBlank()}>
          <FilePlus2 size={14} aria-hidden="true" />
          Start blank
        </button>
      ) : null}
      {saved ? (
        <button type="button" className="button button-primary board-card-reload" onClick={() => window.location.reload()}>
          <RefreshCw size={14} aria-hidden="true" />
          Reload
        </button>
      ) : null}
      {/* The terminal way stays, folded: most people never need it (23#chrome-recedes). */}
      <details className="board-card-terminal">
        <summary>Or from the terminal</summary>
        <div className="command">
          <code>{command}</code>
          <button type="button" className="sheet-action" onClick={copy} aria-label={`Copy the ${boardTitle(board.id)} import command`}>
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </details>
    </article>
  );
}
