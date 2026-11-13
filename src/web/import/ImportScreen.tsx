import { ArrowLeft, BookOpen, ExternalLink, FilePlus2, FileUp, Laptop, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { BoardChoice, ImportResponse } from "../../api/http.ts";
import { boardDisplayName } from "../shell/Header.tsx";
import { CopyCommand } from "../shell/CopyCommand.tsx";
import { RestoreKeyboard, keyboardRemoved } from "../keyboards/RestoreKeyboard.tsx";
import { restoreKeyboard } from "../keyboards/api-keyboards.ts";
import { CONTRIBUTION_GUIDE } from "../keyboards/search-words.ts";
import { activitiesFor, importRefusal, otherBoardWords, restoreFor, retryFor, type ImportRefusal, type Refused } from "./import-words.ts";
import { createConfig } from "../configs/api-configs.ts";
import { ApiError, fetchLayouts } from "../api.ts";
import { IMPORTED_UNREADABLE, fetchBoards, readKarabinerConfig, uploadLayout } from "./api-import.ts";
import { acceptsFile, firstFreeName, guideFor, importCommand, importIntro, offersStartBlank } from "./export-steps.ts";
import { Silhouette } from "../shell/TopBar.tsx";
import { RetryOrRestart, UnexpectedWayOut } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, failsAgain, pageFailure } from "../shell/unexpected.ts";
import { ActivityChoices } from "../review/WorkloadTests.tsx";
import type { ReviewActivity } from "../../api/review.ts";
import "../review/review.css";
import "./import.css";

type Boards = { status: "loading" } | ({ status: "error" } & PageFailure) | { status: "ready"; boards: BoardChoice[] };

interface Props {
  token: string;
  /** Called once the server has saved the layout; the caller shows it. */
  onImported: (result: ImportResponse) => void;
  /** Called with a blank config's id once it is made, when there was nothing to import (R3-12); the caller opens it. */
  onStartedBlank: (layoutId: string) => void;
  /** Present when there is a screen to go back to; the first-run screen with nothing behind it has none. */
  onBack?: (() => void) | undefined;
  /** Where the way back goes, in words (R6-25); "Back to your layouts" from the layout menu. */
  backLabel?: string;
  /** No layout yet: the title is the first layout's, even with a way back to choosing a keyboard. */
  first?: boolean;
  /** Opened from one board's setup card: only that board's card shows, with a way to show every card (R7-13). */
  only?: string | null | undefined;
}

// What the app shows with no layouts, and from the layout menu's "Import a layout" (18#states): one card per board, each
// saying which file to export and taking it by drop, so no terminal is needed. The CLI command stays underneath.
export function ImportScreen({ token, onImported, onStartedBlank, onBack, backLabel = "Back to your layouts", first = onBack === undefined, only = null }: Props) {
  const [boards, setBoards] = useState<Boards>({ status: "loading" });
  const [showAll, setShowAll] = useState(false);
  const shown = boards.status === "ready" ? cardsFor(boards.boards, showAll ? null : only) : [];
  const [attempt, setAttempt] = useState(0);
  const [activities, setActivities] = useState<ReviewActivity[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setBoards({ status: "loading" });
    fetchBoards(token, controller.signal).then(
      (list) => setBoards({ status: "ready", boards: list }),
      (error: unknown) => {
        if (!controller.signal.aborted) setBoards({ status: "error", ...pageFailure(error, "Couldn't load the boards.") });
      },
    );
    return () => controller.abort();
  }, [token, attempt]);

  return (
    <section className="import-screen" aria-labelledby="import-title">
      {onBack === undefined ? null : (
        <button type="button" className="sheet-action import-back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          {backLabel}
        </button>
      )}
      <header className="import-intro">
        <h2 id="import-title">{first ? "Bring in your first layout" : "Import a layout"}</h2>
        {boards.status === "ready" ? <p>{importIntro(shown)}</p> : null}
      </header>
      {/* Tests replay a firmware build, so they are offered only beside a QMK or ZMK card; the MacBook's kanata has none (R6-25). */}
      {shown.some((board) => board.firmware !== "kanata") ? (
        <div className="br-workloads">
          <ActivityChoices value={activities} onChange={setActivities} />
          <p className="muted">Optional, for keyboards with QMK or ZMK firmware: test short US-ANSI samples after import and independently check suggestions. Needs Docker, may download firmware, and can take several minutes. Tests never flash your keyboard.</p>
        </div>
      ) : null}
      {boards.status === "loading" ? (
        <p className="loading" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Loading the boards…</p>
      ) : boards.status === "error" ? (
        <BoardsFailed token={token} failure={boards} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <>
          <ul className="board-cards" aria-label="Supported keyboards">
            {shown.map((board) => (
              <li key={board.id}>
                <BoardCard board={board} boards={boards.boards} token={token} onImported={onImported} onStartedBlank={onStartedBlank} activities={activities} />
              </li>
            ))}
          </ul>
          {shown.length < boards.boards.length ? (
            <p className="muted import-only">
              Your file is for another keyboard? <button type="button" className="link-button" onClick={() => setShowAll(true)}>Show every keyboard</button>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** The board list couldn't be read: why, and Try again, or Restart keyloom for a failure no screen planned for (R8-03). */
export function BoardsFailed({ token, failure, onRetry }: { token: string; failure: PageFailure; onRetry: () => void }) {
  return (
    <div className="import-error" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <p>{failure.message}</p>
      <RetryOrRestart token={token} failure={failure} onRetry={onRetry} />
    </div>
  );
}

/**
 * The cards to show: `only`'s card when the screen opened from that board's setup (R7-13), or every card in order. A board the list
 * doesn't have shows every card, so the screen is never empty.
 */
export function cardsFor(boards: readonly BoardChoice[], only: string | null): BoardChoice[] {
  const one = only === null ? undefined : boards.find((board) => board.id === only);
  return one === undefined ? inOrder(boards) : [one];
}

// The boards BK has, in the order the blueprint names them; any others follow by name.
const FIRST = ["zsa/moonlander", "moergo/glove80", "foostan/corne"];
function inOrder(boards: readonly BoardChoice[]): BoardChoice[] {
  const rank = (board: BoardChoice) => (FIRST.includes(board.id) ? FIRST.indexOf(board.id) : FIRST.length);
  return [...boards].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** One board's card. `activities`: what is ticked above the cards, unfiltered, because Import it as … can send the file to a board that takes tests (#299 review). */
export function BoardCard({ board, boards, token, onImported, onStartedBlank, activities }: { board: BoardChoice; boards: readonly BoardChoice[]; token: string; onImported: (result: ImportResponse) => void; onStartedBlank: (layoutId: string) => void; activities: ReviewActivity[] }) {
  const guide = guideFor(board);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  // Kept whole (R9-05): its code adds Restart keyloom, and the log for an exception, beside the sentence. The card's own controls stay,
  // since each drop is a new file.
  const [problem, setProblem] = useState<PageFailure | null>(null);
  // Which control sent the request that failed (R10-05). Read it from this Mac or Start blank goes off when it would fail the same way
  // again; the drop zone stays, since each drop is a new file.
  const [failedBy, setFailedBy] = useState<CardAction | null>(null);
  const fail = (failure: PageFailure, by: CardAction) => { setProblem(failure); setFailedBy(by); };
  const off = (by: CardAction) => failedBy === by && failsAgain(problem);
  // Saved, but the answer couldn't be read: the page reloads to show it, and the card takes nothing more until then (R2-17).
  const [saved, setSaved] = useState(false);
  // This Mac has no Karabiner settings: nothing to import, so the card offers a blank config instead (R3-12).
  const [nothingToRead, setNothingToRead] = useState(false);
  // A refusal keyloom can act on (R6-08, R6-18), with what was refused and where it went, so Restore or Import it as … does it again.
  const [refused, setRefused] = useState<Refused | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const command = importCommand(board, activitiesFor(board, activities));

  /**
   * `as`: the board a keyloom export was made for, when it was dropped on another board's card (R6-18). `by`: the control that sent it,
   * so Read it from this Mac goes off when the file it read fails to import the same way every time.
   */
  async function take(files: FileList | readonly File[] | null, as: BoardChoice = board, by: CardAction = "file") {
    const file = files?.[0];
    if (file === undefined || busy || saved) return;
    // A file keyloom already read as its own export goes to the board it names, whatever that board's own editor exports.
    if (as === board && !acceptsFile(guide, file.name)) {
      fail({ message: `${file.name} isn't a ${guide.accepts} file. ${guide.steps}` }, "file");
      return;
    }
    setBusy(true);
    setProblem(null);
    setRefused(null);
    try {
      onImported(await uploadLayout(token, as.id, file, activitiesFor(as, activities)));
    } catch (error) {
      if (error instanceof ApiError && error.code === IMPORTED_UNREADABLE) setSaved(true);
      const refusal = importRefusal(error, boards, as);
      if (refusal !== null) setRefused({ refusal, file, as });
      else fail(pageFailure(error, "The import didn't go through."), by);
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
      fail(pageFailure(error, "keyloom couldn't read Karabiner's settings."), "mac");
      setNothingToRead(error instanceof ApiError && offersStartBlank(error.code));
      return;
    } finally {
      setBusy(false);
    }
    await take([file], board, "mac");
  }

  async function startBlank() {
    setBusy(true);
    setProblem(null);
    // A refusal from before Restore must not stay up beside this try's own outcome (#299 review).
    setRefused(null);
    try {
      // Config names are unique, so a second Start blank takes the next free "… daily N" rather than failing the same way each time.
      const taken = (await fetchLayouts(token, new AbortController().signal)).map((layout) => layout.name);
      const config = await createConfig(token, { from: "blank", name: firstFreeName(`${boardDisplayName(board.name)} daily`, taken), board: board.id });
      onStartedBlank(config.id);
    } catch (error) {
      if (keyboardRemoved(error)) setRefused({ refusal: { kind: "removed", boardId: board.id, board }, file: null, as: board });
      else fail(pageFailure(error, "keyloom couldn't start a blank config."), "blank");
    } finally {
      setBusy(false);
    }
  }

  // After Restore, the refused import or blank config again: the file kept from the drop, to the board it went to, or Start blank.
  const again = () => {
    if (refused === null) return;
    const retry = retryFor(refused);
    return retry.kind === "blank" ? startBlank() : take([retry.file], retry.as);
  };
  const restore = refused?.refusal.kind === "removed" ? restoreFor({ ...refused, refusal: refused.refusal }) : null;

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
            <button type="button" className="sheet-action" disabled={busy || saved || off("mac")} onClick={() => void readFromMac()}>
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
      {problem === null ? null : <CardProblem token={token} problem={problem} primary={off("mac") || off("blank")} />}
      {restore === null ? null : (
        <RestoreKeyboard restore={() => restoreKeyboard(token, restore.boardId)} boardName={restore.boardName} doing={restore.doing} onRestored={again} />
      )}
      {refused?.refusal.kind === "other_board" ? (
        <OtherBoard filename={refused.file?.name ?? "This file"} refusal={refused.refusal} here={board} busy={busy}
          onImportAs={(other) => void take(refused.file === null ? null : [refused.file], other)} />
      ) : null}
      {nothingToRead ? (
        <button type="button" className={off("blank") ? "button board-card-reload" : "button button-primary board-card-reload"} disabled={busy || off("blank")} onClick={() => void startBlank()}>
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
        {/* The shared Copy says when the clipboard refused, and selects the command instead (R6-15). */}
        <CopyCommand command={command} />
      </details>
    </article>
  );
}

/** The card's controls that send a request: a dropped or chosen file, Read it from this Mac, Start blank. */
type CardAction = "file" | "mac" | "blank";

/**
 * A card's failed drop, read from this Mac or Start blank (R9-05): the sentence, then Restart keyloom and the log for a failure no screen
 * planned for. The drop zone stays its Try again: each drop is a new file. `primary`: the button that failed went off because it would
 * fail the same way again, so Restart keyloom is the way on (R10-05).
 */
export function CardProblem({ token, problem, primary = false }: { token: string; problem: PageFailure; primary?: boolean }) {
  return (
    <div className="board-card-problem" role="alert">
      <TriangleAlert size={14} aria-hidden="true" />
      <div>
        <p>{problem.message}</p>
        <div className="unexpected-actions"><UnexpectedWayOut token={token} failure={problem} primary={primary} /></div>
      </div>
    </div>
  );
}

/** A keyloom export dropped on another board's card (R6-18): import it as that board's config, or say keyloom doesn't have the board. */
function OtherBoard({ filename, refusal, here, busy, onImportAs }: {
  filename: string; refusal: Extract<ImportRefusal, { kind: "other_board" }>; here: BoardChoice; busy: boolean; onImportAs: (board: BoardChoice) => void;
}) {
  const other = refusal.board;
  return (
    <div className="board-card-problem board-card-refusal" role="alert">
      <TriangleAlert size={14} aria-hidden="true" />
      <div>
        <p>{otherBoardWords(filename, refusal, here)}</p>
        {other === null ? (
          <a className="sheet-action" href={CONTRIBUTION_GUIDE} target="_blank" rel="noopener"><BookOpen size={13} aria-hidden="true" />Open the contribution guide</a>
        ) : (
          <button type="button" className="sheet-action" disabled={busy} onClick={() => onImportAs(other)}><FileUp size={13} aria-hidden="true" />Import it as a {other.name} config</button>
        )}
      </div>
    </div>
  );
}
