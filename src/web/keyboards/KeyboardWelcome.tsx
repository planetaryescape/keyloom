import { ArrowLeft, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { BoardChoice } from "../../api/http.ts";
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

export function KeyboardWelcome({ token, choices, sync, sources, onMade, onManage, onBack }: {
  token: string; choices: readonly BoardChoice[]; sync: SyncApi; sources: readonly PutSource[];
  onMade: (id: string, proposals?: boolean) => void; onManage: () => void; onBack?: (() => void) | undefined;
}) {
  const flow = useNewKeyboard(token, sync.newKeyboards, sync.setupBoards);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [half, setHalf] = useState<"left" | "right">("left");
  const [firmwareSearch, setFirmwareSearch] = useState(false);
  const phone = useMediaQuery(PHONE);
  const search = flow.search;
  useEffect(() => {
    if (!firmwareSearch) return;
    const timer = window.setTimeout(() => void search(query), 200);
    return () => window.clearTimeout(timer);
  }, [query, firmwareSearch, search]);
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
    <header><div>{onBack ? <button className="sheet-action" type="button" onClick={onBack}><ArrowLeft size={14} />Back to your keyboard</button> : null}<h1>{sources.length === 0 ? "Your first keyboard" : "Add a keyboard"}</h1><p>Connect a keyboard or choose it below. Setup never flashes it.</p></div><button type="button" className="sheet-action" onClick={onManage}>Manage keyboards</button></header>
    <div className="onboarding-workbench" data-panel={panel || undefined}>
      <section className="onboarding-stage" aria-label="Keyboard setup">
        {drawn && panel ? <><NewBoardKeyboard board={drawn} display={display} mode={flow.step.kind === "review" ? "review" : flow.step.kind === "put" ? "put" : "confirm"} homeRow={flow.step.kind === "confirm" || flow.step.kind === "review" ? flow.step.homeRow ?? flow.preview?.guessedHomeRow ?? null : null} mapped={flow.putPreview} placed={placed} onPickRow={flow.setHomeRow} half={phone && split ? half : null} />{split ? <div className="onboarding-halves"><button type="button" className="sheet-action" aria-pressed={half === "left"} onClick={() => setHalf("left")}>Left</button><button type="button" className="sheet-action" aria-pressed={half === "right"} onClick={() => setHalf("right")}>Right</button></div> : null}</> : null}
        <NewKeyboardCard flow={flow} />
        <SetupCard flow={flow} onImport={() => setImporting(true)} onMade={onMade} />
        {flow.step.kind === "idle" ? <div className="onboarding-choices">
          <label className="keyboard-picker-search"><Search size={16} /><input type="search" aria-label="Find a keyboard to add" placeholder="Keyboard or maker" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="onboarding-catalogue">
            {rows.map((board) => <button key={board.id} type="button" onClick={() => flow.chooseKnown(board)}>{board.keys ? <Silhouette keys={board.keys} display={board.display} width={48} height={24} /> : null}<span>{board.name}<small>{board.vendor}</small></span></button>)}
            {rows.length === 0 ? <p>No supported board matches. Search the firmware catalogue below, or use the contribution guide.</p> : null}
          </div>
          <button type="button" className="sheet-action" onClick={() => { setFirmwareSearch(true); void flow.search(query); }}>Not listed? Search QMK and ZMK</button>
          {firmwareSearch ? <div className="nb-list">{query.trim().length < 2 ? <p>Type at least two letters in the search above.</p> : flow.found.map((candidate) => <button key={candidate.id} type="button" onClick={() => flow.chooseCandidate(candidate)}>{candidate.displayName}<small>{candidate.detail}</small></button>)}</div> : null}
          {flow.problem ? <p role="alert" className="nb-problem">{flow.problem}</p> : null}
          <p className="nb-note">Already have a keymap? <button type="button" className="sheet-action" onClick={() => setImporting(true)}>Import a layout</button></p>
        </div> : null}
      </section>
      {panel ? <aside className="onboarding-panel"><NewBoardPanel flow={flow} sources={sources} onMade={(id) => onMade(id, flow.step.kind === "put" && flow.step.source !== null)} /><button type="button" className="sheet-action" onClick={() => setImporting(true)}>Import an existing keymap instead</button></aside> : null}
    </div>
    <p className="onboarding-contribution">No custom case yet? Your keys still use the physical renderer. <a href="https://github.com/planetaryescape/keyloom/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener">Model and contribute your keyboard</a> with <code>/add-keyboard</code> in a clone.</p>
  </div>;
}
