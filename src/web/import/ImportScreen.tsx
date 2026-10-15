import { ArrowLeft, Check, Copy, FileUp, Keyboard, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { BoardChoice, ImportResponse } from "../../api/http.ts";
import { boardTitle } from "../shell/Header.tsx";
import { fetchBoards, uploadLayout } from "./api-import.ts";
import { acceptsFile, guideFor, importCommand } from "./export-steps.ts";
import "./import.css";

type Boards = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; boards: BoardChoice[] };

interface Props {
  token: string;
  /** Called once the server has saved the layout; the caller shows it. */
  onImported: (result: ImportResponse) => void;
  /** Present when there are layouts to go back to; the first-run screen has none. */
  onBack?: (() => void) | undefined;
}

// What the app shows with no layouts, and from the layout menu's "Import a layout" (18#states): one card per board, each
// saying which file to export and taking it by drop, so no terminal is needed. The CLI command stays underneath.
export function ImportScreen({ token, onImported, onBack }: Props) {
  const [boards, setBoards] = useState<Boards>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

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
        <button type="button" className="button import-back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to your layouts
        </button>
      )}
      <header className="import-intro">
        <span className="state-icon" aria-hidden="true"><Keyboard size={22} /></span>
        <h2 id="import-title">{onBack === undefined ? "Bring in your first layout" : "Import a layout"}</h2>
        <p>Pick your keyboard, export your layout from its editor, and drop the file on the card. Every layer shows up here.</p>
      </header>
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
              <BoardCard board={board} token={token} onImported={onImported} />
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

function BoardCard({ board, token, onImported }: { board: BoardChoice; token: string; onImported: (result: ImportResponse) => void }) {
  const guide = guideFor(board);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const command = importCommand(board);

  async function take(files: FileList | null) {
    const file = files?.[0];
    if (file === undefined) return;
    if (!acceptsFile(guide, file.name)) {
      setProblem(`${file.name} isn't a ${guide.accepts} file. ${guide.steps}`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      onImported(await uploadLayout(token, board.id, file));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The import didn't go through.");
    } finally {
      setBusy(false);
      // The same file can be chosen again after a fix.
      if (picker.current !== null) picker.current.value = "";
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
    <article className="board-card" aria-labelledby={titleId}>
      <header>
        <h3 id={titleId}>{board.name}</h3>
        <p className="muted">{board.vendor} · {board.keyCount} keys</p>
      </header>
      <p className="board-card-steps">{guide.steps}</p>
      <div
        className="dropzone"
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
        {busy ? <LoaderCircle size={20} className="spin" aria-hidden="true" /> : <FileUp size={20} aria-hidden="true" />}
        <p>{busy ? "Importing…" : `Drop your ${guide.accepts} file here`}</p>
        <button type="button" className="button" disabled={busy} onClick={() => picker.current?.click()}>
          Choose a file
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
      <div className="command">
        <code>{command}</code>
        <button type="button" className="button" onClick={copy} aria-label={`Copy the ${boardTitle(board.id)} import command`}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </article>
  );
}
