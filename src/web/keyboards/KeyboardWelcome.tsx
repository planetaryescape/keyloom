import { ArrowLeft, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { BoardChoice } from "../../api/http.ts";
import { CollectionResponseSchema, type CollectionKeyboard } from "../../api/keyboards.ts";
import { request } from "../api-write.ts";
import type { SyncApi } from "../sync/useSync.ts";
import { ImportScreen } from "../import/ImportScreen.tsx";
import { useNewKeyboard } from "./useNewKeyboard.ts";
import { CONTRIBUTION_GUIDE, searchNote } from "./search-words.ts";
import { NewKeyboardCard } from "./NewKeyboardCard.tsx";
import { SearchFailed } from "./SearchFailed.tsx";
import { SetupCard } from "./SetupCard.tsx";
import { NewBoardPanel, type PutSource } from "./NewBoardPanel.tsx";
import { NewBoardKeyboard } from "./NewBoardKeyboard.tsx";
import { Silhouette } from "../shell/TopBar.tsx";
import { PHONE, useMediaQuery } from "../shell/useMediaQuery.ts";
import { isOnePiece } from "../../boards/one-piece.ts";
import { applyDisplayRotation } from "../keyboard/geometry.ts";
import { catalogueNote, type BoardsRead } from "./catalogue-words.ts";
import { welcomeLead } from "./onboarding-words.ts";
import "./collection.css";

export function KeyboardWelcome({ token, choices, boardsRead = "ready", onRetryBoards, sync, sources, onMade, onManage, onBack, collectionVersion = 0 }: {
  token: string; choices: readonly BoardChoice[];
  /** Where the read of `choices` stands (R6-04): the list says it is reading, or that it couldn't, with Try again. */
  boardsRead?: BoardsRead; onRetryBoards?: () => void;
  sync: SyncApi; sources: readonly PutSource[];
  onMade: (id: string, proposals?: boolean) => void; onManage: (removed?: boolean) => void; onBack?: (() => void) | undefined; collectionVersion?: number;
}) {
  const flow = useNewKeyboard(token, sync.newKeyboards, sync.setupBoards);
  const [query, setQuery] = useState("");
  // The import screen, at one board's card when it opened from that board's setup (R7-13), or at every card.
  const [importing, setImporting] = useState<{ board: string | null } | null>(null);
  const [half, setHalf] = useState<"left" | "right">("left");
  const [firmwareSearch, setFirmwareSearch] = useState(false);
  const [collection, setCollection] = useState<CollectionKeyboard[] | null>(null);
  const [collectionProblem, setCollectionProblem] = useState(false);
  const [collectionAttempt, setCollectionAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCollection(null); setCollectionProblem(false);
    void request("GET", "/api/keyboards/collection", token, CollectionResponseSchema, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setCollection(result.keyboards); },
      () => { if (!controller.signal.aborted) setCollectionProblem(true); },
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
  if (importing !== null) return <ImportScreen token={token} onImported={(result) => onMade(result.layoutId)} onStartedBlank={onMade} onBack={() => setImporting(null)} backLabel="Back to choosing a keyboard" first={sources.length === 0} only={importing.board} />;
  const targetId = flow.step.kind === "put" ? flow.step.boardId : null;
  const chosenId = flow.step.kind === "put" || flow.step.kind === "setup" ? flow.step.boardId : null;
  const chosen = choices.find((board) => board.id === chosenId)?.firmware ?? null;
  const known = choices.find((board) => board.id === targetId);
  const drawn = flow.preview?.board ?? (known?.keys && known.hands && known.fingers && known.rows ? {
    keys: applyDisplayRotation(known.keys, known.display), hands: known.hands, fingers: known.fingers,
    rows: Object.entries(known.rows).map(([name, positions]) => ({ name, positions })),
  } : null);
  const display = flow.preview?.board ? undefined : known?.display;
  const split = drawn !== null && !isOnePiece({ hands: drawn.hands, display }, drawn.keys);
  const placed = new Set(flow.putPreview?.placements.flatMap((placement) => {
    if (flow.step.kind !== "put" || placement.blocked !== undefined || !placement.candidates[0]) return [];
    return [flow.step.choices[String(placement.source)] ?? placement.candidates[0].target];
  }) ?? []);
  const panel = flow.step.kind === "confirm" || flow.step.kind === "review" || flow.step.kind === "put";
  const rows = choices.filter((board) => `${board.name} ${board.vendor} ${board.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const note = catalogueNote(boardsRead, collection !== null ? "ready" : collectionProblem ? "failed" : "loading", rows.length, firmwareSearch);
  return <div className="keyboard-welcome">
    <header><div>{onBack ? <button className="sheet-action" type="button" onClick={onBack}><ArrowLeft size={14} />Back to your keyboard</button> : null}<h1>{sources.length === 0 ? "Your first keyboard" : "Add a keyboard"}</h1><p>{welcomeLead(chosen)}</p></div><button type="button" className="sheet-action" onClick={() => onManage()}>Manage keyboards</button></header>
    <div className="onboarding-workbench" data-panel={panel || undefined}>
      <section className="onboarding-stage" aria-label="Keyboard setup">
        {drawn && panel ? <><NewBoardKeyboard board={drawn} display={display} mode={flow.step.kind === "review" ? "review" : flow.step.kind === "put" ? "put" : "confirm"} homeRow={flow.step.kind === "confirm" || flow.step.kind === "review" ? flow.step.homeRow ?? flow.preview?.guessedHomeRow ?? null : null} mapped={flow.putPreview} placed={placed} onPickRow={flow.setHomeRow} half={phone && split ? half : null} />{split ? <div className="onboarding-halves"><button type="button" className="sheet-action" aria-pressed={half === "left"} onClick={() => setHalf("left")}>Left</button><button type="button" className="sheet-action" aria-pressed={half === "right"} onClick={() => setHalf("right")}>Right</button></div> : null}</> : null}
        <NewKeyboardCard flow={flow} />
        <SetupCard flow={flow} boards={choices} hasConfigs={sources.length > 0} onImport={(board) => setImporting({ board })} onMade={onMade} />
        {flow.step.kind === "idle" ? <div className="onboarding-choices">
          <label className="keyboard-picker-search"><Search size={16} /><input type="search" aria-label="Find a keyboard to add" placeholder="Keyboard or maker" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="onboarding-catalogue">
            {note === "boards_failed" ? <p role="alert">keyloom couldn't read its keyboard list. {onRetryBoards === undefined ? null : <button type="button" className="sheet-action" onClick={onRetryBoards}><RefreshCw size={13} aria-hidden="true" />Try again</button>}</p>
              : note === "boards_loading" ? <p role="status">Reading keyloom's keyboard list…</p>
              : note === "collection_failed" ? <p role="alert">Couldn't check your keyboard collection. <button type="button" className="sheet-action" onClick={() => setCollectionAttempt((n) => n + 1)}>Try again</button></p>
              : collection === null ? <p role="status">Checking your keyboard collection…</p> : rows.map((board) => {
              const removed = collection.some((keyboard) => keyboard.boardId === board.id && keyboard.removedAt !== null);
              return <button key={board.id} type="button" onClick={() => removed ? onManage(true) : flow.chooseKnown(board)}>{board.keys ? <Silhouette keys={board.keys} display={board.display} width={48} height={24} /> : null}<span>{board.name}<small>{removed ? "Removed · restore" : board.vendor}</small></span></button>;
            })}
            {/* Once the QMK and ZMK search runs, its own answer below says what to do next. */}
            {note === "none" ? <p>No supported board matches. <button type="button" className="link-button" onClick={() => { setFirmwareSearch(true); void flow.search(query); }}>Search QMK and ZMK</button> for it, or read <a href={CONTRIBUTION_GUIDE} target="_blank" rel="noopener">the contribution guide</a>.</p> : null}
          </div>
          <button type="button" className="sheet-action" disabled={collection === null} onClick={() => { setFirmwareSearch(true); void flow.search(query); }}>Not listed? Search QMK and ZMK</button>
          {firmwareSearch && collection !== null ? <FirmwareResults query={query} flow={flow} /> : null}
          {flow.problem ? <p role="alert" className="nb-problem">{flow.problem}</p> : null}
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
