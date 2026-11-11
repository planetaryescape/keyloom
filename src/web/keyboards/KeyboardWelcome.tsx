import { ArrowLeft, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { BoardChoice } from "../../api/http.ts";
import { CollectionResponseSchema, type CollectionKeyboard } from "../../api/keyboards.ts";
import { request } from "../api-write.ts";
import type { SyncApi } from "../sync/useSync.ts";
import { ImportScreen } from "../import/ImportScreen.tsx";
import { useNewKeyboard } from "./useNewKeyboard.ts";
import { NewKeyboardCard } from "./NewKeyboardCard.tsx";
import { SetupCard } from "./SetupCard.tsx";
import { NewBoardPanel, type PutSource } from "./NewBoardPanel.tsx";
import { NewBoardKeyboard } from "./NewBoardKeyboard.tsx";
import { Silhouette } from "../shell/TopBar.tsx";
import { PHONE, useMediaQuery } from "../shell/useMediaQuery.ts";
import { isOnePiece } from "../../boards/one-piece.ts";
import { applyDisplayRotation } from "../keyboard/geometry.ts";
import "./collection.css";

export function KeyboardWelcome({ token, choices, sync, sources, onMade, onManage, onBack, collectionVersion = 0 }: {
  token: string; choices: readonly BoardChoice[]; sync: SyncApi; sources: readonly PutSource[];
  onMade: (id: string, proposals?: boolean) => void; onManage: (removed?: boolean) => void; onBack?: (() => void) | undefined; collectionVersion?: number;
}) {
  const flow = useNewKeyboard(token, sync.newKeyboards, sync.setupBoards);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
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
  if (importing) return <ImportScreen token={token} onImported={(result) => onMade(result.layoutId)} onBack={() => setImporting(false)} />;
  const targetId = flow.step.kind === "put" ? flow.step.boardId : null;
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
  return <div className="keyboard-welcome">
    <header><div>{onBack ? <button className="sheet-action" type="button" onClick={onBack}><ArrowLeft size={14} />Back to your keyboard</button> : null}<h1>{sources.length === 0 ? "Your first keyboard" : "Add a keyboard"}</h1><p>Connect a keyboard or choose it below. Setup never flashes it.</p></div><button type="button" className="sheet-action" onClick={() => onManage()}>Manage keyboards</button></header>
    <div className="onboarding-workbench" data-panel={panel || undefined}>
      <section className="onboarding-stage" aria-label="Keyboard setup">
        {drawn && panel ? <><NewBoardKeyboard board={drawn} display={display} mode={flow.step.kind === "review" ? "review" : flow.step.kind === "put" ? "put" : "confirm"} homeRow={flow.step.kind === "confirm" || flow.step.kind === "review" ? flow.step.homeRow ?? flow.preview?.guessedHomeRow ?? null : null} mapped={flow.putPreview} placed={placed} onPickRow={flow.setHomeRow} half={phone && split ? half : null} />{split ? <div className="onboarding-halves"><button type="button" className="sheet-action" aria-pressed={half === "left"} onClick={() => setHalf("left")}>Left</button><button type="button" className="sheet-action" aria-pressed={half === "right"} onClick={() => setHalf("right")}>Right</button></div> : null}</> : null}
        <NewKeyboardCard flow={flow} />
        <SetupCard flow={flow} hasConfigs={sources.length > 0} onImport={() => setImporting(true)} onMade={onMade} />
        {flow.step.kind === "idle" ? <div className="onboarding-choices">
          <label className="keyboard-picker-search"><Search size={16} /><input type="search" aria-label="Find a keyboard to add" placeholder="Keyboard or maker" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="onboarding-catalogue">
            {collection === null ? collectionProblem ? <p role="alert">Couldn't check your keyboard collection. <button type="button" className="sheet-action" onClick={() => setCollectionAttempt((n) => n + 1)}>Try again</button></p> : <p role="status">Checking your keyboard collection…</p> : rows.map((board) => {
              const removed = collection.some((keyboard) => keyboard.boardId === board.id && keyboard.removedAt !== null);
              return <button key={board.id} type="button" onClick={() => removed ? onManage(true) : flow.chooseKnown(board)}>{board.keys ? <Silhouette keys={board.keys} display={board.display} width={48} height={24} /> : null}<span>{board.name}<small>{removed ? "Removed · restore" : board.vendor}</small></span></button>;
            })}
            {collection !== null && rows.length === 0 ? <p>No supported board matches. <button type="button" className="link-button" onClick={() => { setFirmwareSearch(true); void flow.search(query); }}>Search QMK and ZMK</button> for it, or read <a href="https://github.com/planetaryescape/keyloom/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener">the contribution guide</a>.</p> : null}
          </div>
          <button type="button" className="sheet-action" disabled={collection === null} onClick={() => { setFirmwareSearch(true); void flow.search(query); }}>Not listed? Search QMK and ZMK</button>
          {firmwareSearch && collection !== null ? <div className="nb-list">{query.trim().length < 2 ? <p>Type at least two letters in the search above.</p> : flow.found.map((candidate) => <button key={candidate.id} type="button" onClick={() => flow.chooseCandidate(candidate)}>{candidate.displayName}<small>{candidate.detail}</small></button>)}</div> : null}
          {flow.problem ? <p role="alert" className="nb-problem">{flow.problem}</p> : null}
          <p className="nb-note">Already have a keymap? <button type="button" className="sheet-action" onClick={() => setImporting(true)}>Import a layout</button></p>
        </div> : null}
      </section>
      {panel ? <aside className="onboarding-panel"><NewBoardPanel flow={flow} sources={sources} onMade={(id) => onMade(id, flow.step.kind === "put" && flow.step.source !== null)} /><button type="button" className="sheet-action" onClick={() => setImporting(true)}>Import an existing keymap instead</button></aside> : null}
    </div>
    {/* Words for someone who isn't a developer (R1-30): the app prepares the folder; the guide is for whoever takes it further. */}
    <p className="onboarding-contribution">No drawing of your keyboard&rsquo;s case yet? Its keys still show. To share your keyboard with keyloom, <button type="button" className="link-button" onClick={() => onManage()}>Manage keyboards</button> prepares it as a download. <a href="https://github.com/planetaryescape/keyloom/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener">The contribution guide</a> says what happens next.</p>
  </div>;
}
