import { ArrowLeft, RefreshCw, Search, Usb } from "lucide-react";
import { useEffect, useState } from "react";
import type { BoardChoice } from "../../api/http.ts";
import type { DetectedKeyboard } from "../../api/detected-keyboards.ts";
import { CollectionResponseSchema, type CollectionKeyboard } from "../../api/keyboards.ts";
import { request } from "../api-write.ts";
import type { SyncApi } from "../sync/useSync.ts";
import { ImportScreen } from "../import/ImportScreen.tsx";
import { type CardMemory, keyboardKey, useNewKeyboard } from "./useNewKeyboard.ts";
import { CONTRIBUTION_GUIDE, searchNote } from "./search-words.ts";
import { NewKeyboardCard } from "./NewKeyboardCard.tsx";
import { SearchFailed } from "./SearchFailed.tsx";
import { SetupCard } from "./SetupCard.tsx";
import { FlowProblem } from "./FlowProblem.tsx";
import { NewBoardPanel, type PutSource } from "./NewBoardPanel.tsx";
import { NewBoardKeyboard, newBoardHalf } from "./NewBoardKeyboard.tsx";
import { Silhouette } from "../shell/TopBar.tsx";
import { PHONE, useMediaQuery } from "../shell/useMediaQuery.ts";
import { isOnePiece } from "../../boards/one-piece.ts";
import { applyDisplayRotation } from "../keyboard/geometry.ts";
import { catalogueNote, type BoardsRead } from "./catalogue-words.ts";
import { welcomeLead } from "./onboarding-words.ts";
import { RetryOrRestart } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, pageFailure, wayOutFor } from "../shell/unexpected.ts";
import "./collection.css";

export function KeyboardWelcome({ token, choices, boardsRead = "ready", boardsFailure = null, onRetryBoards, onBoardAdded, setup = null, onSetupOpened, sync, sources, onMade, onManage, onBack, collectionVersion = 0, cardMemory, onImportHold }: {
  token: string; choices: readonly BoardChoice[];
  /** Where the read of `choices` stands (R6-04): the list says it is reading, or that it couldn't, with Try again. */
  boardsRead?: BoardsRead; onRetryBoards?: () => void;
  /** Why the read of `choices` failed, so its code picks Restart keyloom where a second read fails the same way (R9-05). */
  boardsFailure?: PageFailure | null;
  /** A keyboard was just added: `choices` is read again, so one left with Later is in the list below (R8-06). */
  onBoardAdded?: () => void;
  /** A keyboard whose Set up was pressed in Your keyboards: its setup card opens, and `onSetupOpened` says so (R8-06). */
  setup?: { id: string; name: string } | null; onSetupOpened?: () => void;
  sync: SyncApi; sources: readonly PutSource[];
  onMade: (id: string, proposals?: boolean) => void; onManage: (removed?: boolean) => void; onBack?: (() => void) | undefined; collectionVersion?: number;
  /** The import screen's hold (R11-01): App keeps this screen up while an import's note is still to show. */
  onImportHold?: ((holding: boolean) => void) | undefined;
  /** App's memory of the cards already shown or put off, so the editor doesn't open them again (R10-08). */
  cardMemory?: CardMemory | undefined;
}) {
  const flow = useNewKeyboard(token, sync.newKeyboards, sync.setupBoards, onBoardAdded, { memory: cardMemory });
  const chooseKnown = flow.chooseKnown;
  // The import screen, at one board's card when it opened from that board's setup (R7-13), or at every card.
  const [importing, setImporting] = useState<{ board: string | null } | null>(null);
  useEffect(() => {
    if (setup === null) return;
    chooseKnown(setup);
    // The import screen covers the setup card, so Set up pressed while it shows would seem to do nothing (PR #307 review).
    setImporting(null);
    onSetupOpened?.();
    // Opened once per Set up: the callbacks are rebuilt each render and say nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);
  const [query, setQuery] = useState("");
  const [half, setHalf] = useState<"left" | "right">("left");
  const [firmwareSearch, setFirmwareSearch] = useState(false);
  const [collection, setCollection] = useState<CollectionKeyboard[] | null>(null);
  // Kept whole, so a failure no screen planned for offers Restart keyloom, not a Try again that fails the same way (R9-05).
  const [collectionProblem, setCollectionProblem] = useState<PageFailure | null>(null);
  const [collectionAttempt, setCollectionAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCollection(null); setCollectionProblem(null);
    void request("GET", "/api/keyboards/collection", token, CollectionResponseSchema, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setCollection(result.keyboards); },
      (error: unknown) => { if (!controller.signal.aborted) setCollectionProblem(pageFailure(error, "")); },
    );
    return () => controller.abort();
  }, [token, collectionVersion, collectionAttempt]);
  const phone = useMediaQuery(PHONE);
  const search = flow.search;
  useEffect(() => {
    if (!firmwareSearch || collection === null) return;
    const timer = window.setTimeout(() => void search(query), 200);
    return () => window.clearTimeout(timer);
  }, [query, firmwareSearch, search, collection]);
  // The import screen's way back names this screen, and its title is a first layout's on a first run (R6-25).
  if (importing !== null) return <ImportScreen token={token} onImported={(result) => onMade(result.layoutId)} onStartedBlank={onMade} onBack={() => setImporting(null)} backLabel="Back to choosing a keyboard" first={sources.length === 0} only={importing.board} onHold={onImportHold} />;
  const targetId = flow.step.kind === "put" ? flow.step.boardId : null;
  const chosenId = flow.step.kind === "put" || flow.step.kind === "setup" ? flow.step.boardId : null;
  const chosen = choices.find((board) => board.id === chosenId)?.firmware ?? null;
  const known = choices.find((board) => board.id === targetId);
  const drawn = flow.preview?.board ?? (known?.keys && known.hands && known.fingers && known.rows ? {
    keys: applyDisplayRotation(known.keys, known.display), hands: known.hands, fingers: known.fingers,
    rows: Object.entries(known.rows).map(([name, positions]) => ({ name, positions })),
  } : null);
  const display = flow.preview?.board ? undefined : known?.display;
  const shownHalf = newBoardHalf(phone, drawn, display, half);
  const split = drawn !== null && !isOnePiece({ hands: drawn.hands, display }, drawn.keys);
  const placed = new Set(flow.putPreview?.placements.flatMap((placement) => {
    if (flow.step.kind !== "put" || placement.blocked !== undefined || !placement.candidates[0]) return [];
    return [flow.step.choices[String(placement.source)] ?? placement.candidates[0].target];
  }) ?? []);
  const panel = flow.step.kind === "confirm" || flow.step.kind === "review" || flow.step.kind === "put";
  const rows = choices.filter((board) => `${board.name} ${board.vendor} ${board.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const note = catalogueNote(boardsRead, collection !== null ? "ready" : collectionProblem !== null ? "failed" : "loading", rows.length, firmwareSearch);
  return <div className="keyboard-welcome">
    <header><div>{onBack ? <button className="sheet-action" type="button" onClick={onBack}><ArrowLeft size={14} />Back to your keyboard</button> : null}<h1>{sources.length === 0 ? "Your first keyboard" : "Add a keyboard"}</h1><p>{welcomeLead(chosen, flow.step.kind === "idle")}</p></div><button type="button" className="sheet-action" onClick={() => onManage()}>Manage keyboards</button></header>
    <div className="onboarding-workbench" data-panel={panel || undefined}>
      <section className="onboarding-stage" aria-label="Keyboard setup">
        {drawn && panel ? <><NewBoardKeyboard board={drawn} display={display} mode={flow.step.kind === "review" ? "review" : flow.step.kind === "put" ? "put" : "confirm"} homeRow={flow.step.kind === "confirm" || flow.step.kind === "review" ? flow.step.homeRow ?? flow.preview?.guessedHomeRow ?? null : null} mapped={flow.putPreview} placed={placed} onPickRow={flow.setHomeRow} half={shownHalf} onSwipe={shownHalf === null ? undefined : (direction) => setHalf(direction === "left" ? "right" : "left")} />{split ? <div className="onboarding-halves"><button type="button" className="sheet-action" aria-pressed={half === "left"} onClick={() => setHalf("left")}>Left</button><button type="button" className="sheet-action" aria-pressed={half === "right"} onClick={() => setHalf("right")}>Right</button></div> : null}</> : null}
        <NewKeyboardCard flow={flow} />
        <SetupCard flow={flow} boards={choices} hasConfigs={sources.length > 0} onImport={(board) => setImporting({ board })} onMade={onMade} />
        {flow.step.kind === "idle" ? <div className="onboarding-choices">
          <label className="keyboard-picker-search"><Search size={16} /><input type="search" aria-label="Find a keyboard to add" placeholder="Keyboard or maker" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          {/* A plugged-in keyboard put off with Not now stays one press away, as the editor's chip keeps it (R8-15). */}
          <PluggedIn waiting={flow.waiting} onReopen={flow.reopen} />
          <div className="onboarding-catalogue">
            {note === "boards_failed" ? <ReadFailed token={token} words="keyloom couldn't read its keyboard list." failure={boardsFailure} onRetry={onRetryBoards} />
              : note === "boards_loading" ? <p role="status">Reading keyloom's keyboard list…</p>
              : note === "collection_failed" ? <ReadFailed token={token} words="Couldn't check your keyboard collection." failure={collectionProblem} onRetry={() => setCollectionAttempt((n) => n + 1)} />
              : collection === null ? <p role="status">Checking your keyboard collection…</p> : rows.map((board) => {
              const removed = collection.some((keyboard) => keyboard.boardId === board.id && keyboard.removedAt !== null);
              return <button key={board.id} type="button" onClick={() => removed ? onManage(true) : flow.chooseKnown(board)}>{board.keys ? <Silhouette keys={board.keys} display={board.display} width={48} height={24} /> : null}<span>{board.name}<small>{removed ? "Removed · restore" : board.vendor}</small></span></button>;
            })}
            {/* Once the QMK and ZMK search runs, its own answer below says what to do next. */}
            {note === "none" ? <p>No supported board matches. <button type="button" className="link-button" onClick={() => { setFirmwareSearch(true); void flow.search(query); }}>Search QMK and ZMK</button> for it, or read <a href={CONTRIBUTION_GUIDE} target="_blank" rel="noopener">the contribution guide</a>.</p> : null}
          </div>
          <button type="button" className="sheet-action" disabled={collection === null} onClick={() => { setFirmwareSearch(true); void flow.search(query); }}>Not listed? Search QMK and ZMK</button>
          {firmwareSearch && collection !== null ? <FirmwareResults query={query} flow={flow} /> : null}
          <FlowProblem flow={flow} />
          {firmwareSearch && flow.searchProblem !== null ? <SearchFailed flow={flow} /> : null}
          <p className="nb-note">Already have a keymap? <button type="button" className="sheet-action" onClick={() => setImporting({ board: null })}>Import a layout</button></p>
        </div> : null}
      </section>
      {panel ? <aside className="onboarding-panel"><NewBoardPanel flow={flow} sources={sources} onMade={(id) => onMade(id, flow.step.kind === "put" && flow.step.source !== null)} onImport={(board) => setImporting({ board })} /><button type="button" className="sheet-action" onClick={() => setImporting({ board: targetId })}>Import an existing keymap instead</button></aside> : null}
    </div>
    {/* Words for someone who isn't a developer (R1-30): the app prepares the folder; the guide is for whoever takes it further. */}
    <p className="onboarding-contribution">No drawing of your keyboard&rsquo;s case yet? Its keys still show. To share your keyboard with keyloom, <button type="button" className="link-button" onClick={() => onManage()}>Manage keyboards</button> prepares it as a download. <a href={CONTRIBUTION_GUIDE} target="_blank" rel="noopener">The contribution guide</a> says what happens next.</p>
  </div>;
}

/**
 * A read the welcome's list waits on that failed (R9-05): its sentence, then Try again, or Restart keyloom (and the log) for a failure no
 * screen planned for. The page's sentence is said first; keyloom's own words follow only for such a failure, where they explain the button.
 */
export function ReadFailed({ token, words, failure, onRetry }: { token: string; words: string; failure: PageFailure | null; onRetry?: (() => void) | undefined }) {
  const unexpected = failure !== null && failure.message !== "" && wayOutFor(failure, true) !== null ? failure.message : null;
  return (
    <div className="onboarding-read-failed" role="alert">
      <span>{words}{unexpected === null ? "" : ` ${unexpected}`}</span>
      {onRetry === undefined ? null : failure === null ? (
        <button type="button" className="sheet-action" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" />Try again</button>
      ) : <RetryOrRestart token={token} failure={failure} onRetry={onRetry} className="sheet-action" />}
    </div>
  );
}

/** A plugged-in keyboard keyloom hasn't met, put off with Not now: one press opens its card again (R8-15). */
export function PluggedIn({ waiting, onReopen }: { waiting: readonly DetectedKeyboard[]; onReopen: (keyboard: DetectedKeyboard) => void }) {
  if (waiting.length === 0) return null;
  return (
    <p className="onboarding-waiting">
      {waiting.map((keyboard) => (
        <button key={keyboardKey(keyboard)} type="button" className="sheet-action" onClick={() => onReopen(keyboard)}>
          <Usb size={13} aria-hidden="true" />Set up the keyboard you plugged in{keyboard.device.product === "" ? "" : ` (${keyboard.device.product})`}
        </button>
      ))}
    </p>
  );
}

/** The QMK and ZMK results under the search, or why there are none yet (R4-12). */
function FirmwareResults({ query, flow }: { query: string; flow: ReturnType<typeof useNewKeyboard> }) {
  const note = searchNote(query, flow.foundFor, flow.found.length, flow.searchProblem !== null);
  return (
    <div className="nb-list" aria-live="polite">
      {note === "too_short" ? <p>Type at least two letters in the search above.</p>
        : note === "searching" ? <p role="status">Searching QMK and ZMK…</p>
        : note === "none" ? <p>QMK and ZMK have no keyboard called “{query.trim()}”. Try its maker or another spelling. If it isn&rsquo;t there at all, <a href={CONTRIBUTION_GUIDE} target="_blank" rel="noopener">the contribution guide</a> says how to add it.</p>
        // Results for an earlier text, or kept from before a failed search, don't answer this one (#290 review).
        : flow.searchProblem !== null || flow.foundFor !== query.trim() ? null
        : flow.found.map((candidate) => <button key={candidate.id} type="button" onClick={() => flow.chooseCandidate(candidate)}>{candidate.displayName}<small>{candidate.detail}</small></button>)}
    </div>
  );
}
