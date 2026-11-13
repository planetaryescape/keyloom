import { ArrowLeft, BookOpen, FilePlus2, FileUp, LoaderCircle, RefreshCw, Search, Zap } from "lucide-react";
import { useState } from "react";
import { ActivityChoices } from "../review/WorkloadTests.tsx";
import "../review/review.css";
import type { PreviewResponse, PutPreviewResponse } from "../../api/keyboards.ts";
import { niceLayerName } from "../../layout/layer-ops.ts";
import { layoutUnpicked, type NewKeyboard } from "./useNewKeyboard.ts";
import "./keyboards.css";
import { isOnePiece } from "../../boards/one-piece.ts";
import { ChoiceGroup } from "../editor/ChoiceGroup.tsx";
import "../editor/editor.css";
import { deriveProblem, type DeriveProblem } from "./derive-words.ts";
import { CONTRIBUTION_GUIDE } from "./search-words.ts";
import { RestoreKeyboard } from "./RestoreKeyboard.tsx";
import { firstFlashLine } from "./first-flash-words.ts";
import { FINGER_LETTERS } from "./NewBoardKeyboard.tsx";
import { UnexpectedWayOut } from "../shell/UnexpectedWayOut.tsx";

/** `boardId` leaves out the configs already on the board being put on: a put copies across boards, and `config new` copies within one. */
export type PutSource = { id: string; name: string; boardName: string; boardId?: string; note: string | null };

const ROW_WORDS = ["Top row", "Second row", "Third row", "Fourth row", "Fifth row", "Sixth row"];
/** "Top row", "Middle row" and "Bottom row" on a three-row board; counted from the top on others. */
function rowWord(row: number, rows: number): string {
  if (rows === 3) return ["Top row", "Middle row", "Bottom row"][row - 1] ?? `Row ${row}`;
  if (row === rows) return "Bottom row";
  return ROW_WORDS[row - 1] ?? `Row ${row}`;
}

/** The Review step's way back names every question the Confirm step asked: "Home row", "Home row and layout", "Home row, layout and controller". */
export function reviewBackLabel(layout: boolean, controller: boolean): string {
  const asked = ["Home row", ...(layout ? ["layout"] : []), ...(controller ? ["controller"] : [])];
  return asked.length === 1 ? asked[0] as string : `${asked.slice(0, -1).join(", ")} and ${asked.at(-1) as string}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** ": most because the new board has no key in this place (Bri−, Bri+, Mute…)": the commonest reason, with a few of its keys. */
function mostCommon(behind: PutPreviewResponse["notCarried"]): string {
  const byWhy = new Map<string, string[]>();
  for (const n of behind) byWhy.set(n.why, [...(byWhy.get(n.why) ?? []), n.sourceName.replace(/ \(.*\)$/, "")]);
  const [why, names] = [...byWhy].sort((a, b) => b[1].length - a[1].length)[0] ?? ["", []];
  if (why === "") return "";
  const few = `${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}`;
  return names.length === behind.length ? `: ${why} (${few})` : `, ${names.length} of them because ${why} (${few})`;
}

/** How the first flash goes, in words (D-336): keyloom never flashes from here; a board with no recipe says "manual" and why. */
export function FlashWords({ flash, boardName }: { flash: { kind: string; manualReason: string | null; steps: string[] }; boardName: string }) {
  return (
    <div className="nb-flash">
      <Zap size={14} aria-hidden="true" />
      {flash.kind === "manual" ? (
        <p>
          <b>keyloom can't flash this board yet.</b> {flash.manualReason ?? "keyloom has no recipe for its bootloader."} Flash it by hand with the file Build and flash makes; keyloom
          says where it is. Its recipe is <b>manual</b>.
        </p>
      ) : (
        <p>
          <b>keyloom won't flash from here.</b> The first flash is by hand: {firstFlashLine(flash.steps)} After that first one, keyloom can sync your {boardName} for you.
        </p>
      )}
    </div>
  );
}

// The side column of the new-keyboard flow (n2 to n4, D-336): the two questions USB can't answer, the board as keyloom read it, and
// putting a config on it. Every choice is a visible button or row; the board beside it shows each one as it is made.
// `onImport` opens the import screen, showing that board's card when the board is known.
export function NewBoardPanel({ flow, sources, onMade, onImport }: {
  flow: NewKeyboard; sources: readonly PutSource[]; onMade: (configId: string) => void; onImport?: ((boardId: string | null) => void) | undefined;
}) {
  const { step, preview } = flow;
  if (step.kind === "confirm") return <Confirm flow={flow} preview={preview} known={{ sources, onMade, onImport }} />;
  if (step.kind === "review") return <Review flow={flow} preview={preview} known={{ sources, onMade, onImport }} />;
  if (step.kind === "put") return <Put flow={flow} sources={sources.filter((s) => s.boardId !== step.boardId)} preview={flow.putPreview} onMade={onMade} />;
  return null;
}

/** What a keyboard keyloom already has can be given: the configs to put on it, and the ways to start one of its own. */
type KnownWays = { sources: readonly PutSource[]; onMade: (configId: string) => void; onImport?: ((boardId: string | null) => void) | undefined };

/**
 * The keyboard picked as new is one keyloom already has (R6-07): put a config on that board, or pick another keyboard. With no config to
 * put on it, as on a first run, it offers what can be done: start one, or import one (R7-10).
 */
function KnownBoard({ flow, known }: { flow: NewKeyboard; known: KnownWays }) {
  const board = flow.previewProblemBoard;
  const canPut = known.sources.some((s) => s.boardId !== board?.id);
  const start = async () => {
    if (board === null) return;
    const id = await flow.startBlank(`${board.name} daily`, { free: true });
    if (id !== null) known.onMade(id);
  };
  return (
    <div className="nb-problem nb-cant" role="alert">
      <p>keyloom knows this keyboard, so there is nothing to add. {canPut ? "Put one of your configs on it, or start one of its own." : "Start a config for it, or import one."}</p>
      <p className="nb-actions">
        {canPut ? (
          <button type="button" className="sheet-action" onClick={flow.putOnKnown}><FilePlus2 size={13} aria-hidden="true" />Put a config on it</button>
        ) : (
          <>
            <button type="button" className="sheet-action" disabled={flow.busy} onClick={() => void start()}>
              {flow.busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <FilePlus2 size={13} aria-hidden="true" />}Start a config
            </button>
            {known.onImport === undefined ? null : (
              <button type="button" className="sheet-action" onClick={() => known.onImport?.(board?.id ?? null)}><FileUp size={13} aria-hidden="true" />Import one</button>
            )}
          </>
        )}
        <button type="button" className="sheet-action" onClick={flow.backToCard}><ArrowLeft size={13} aria-hidden="true" />Pick another keyboard</button>
      </p>
      {flow.removed === "blank" && board !== null ? (
        <RestoreKeyboard restore={() => flow.restoreKeyboard(board.id)} boardName={board.name} doing="start a config" onRestored={start} />
      ) : null}
    </div>
  );
}

/** keyloom has a board for this candidate: its preview was refused with the board's id (R6-07). */
const knownBoard = (flow: Pick<NewKeyboard, "previewProblemCode" | "previewProblemBoard">): boolean => flow.previewProblemCode === "board_known" && flow.previewProblemBoard !== null;

/** A keyboard keyloom can't add yet (R5-06): why, in words, the contribution guide that says how it learns one, and another keyboard. */
function CantAdd({ flow, problem }: { flow: NewKeyboard; problem: DeriveProblem }) {
  return (
    <div className="nb-problem nb-cant" role="alert">
      <p>{problem.text}</p>
      <p className="nb-actions">
        <a className="sheet-action" href={CONTRIBUTION_GUIDE} target="_blank" rel="noopener"><BookOpen size={13} aria-hidden="true" />Open the contribution guide</a>
        <button type="button" className="sheet-action" onClick={flow.backToCard}><ArrowLeft size={13} aria-hidden="true" />Pick another keyboard</button>
      </p>
    </div>
  );
}

// A preview that couldn't be read says why and reads it again, instead of "Reading…" for ever (R3-08). One that can't work for this
// keyboard says why without a Try again that would fail the same way (R5-06).
function Reading({ flow, name, known: ways }: { flow: NewKeyboard; name: string; known: KnownWays }) {
  if (flow.previewProblem === null) return <p className="nb-note"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Reading…</p>;
  if (knownBoard(flow)) return <KnownBoard flow={flow} known={ways} />;
  const known = deriveProblem(flow.previewProblemCode, name);
  if (known?.blocked === true) return <CantAdd flow={flow} problem={known} />;
  // A failure no screen planned for gets Restart keyloom, with Try again only for an exception; a mismatch fails the same way again (R8-03).
  return (
    <div className="nb-problem" role="alert">
      <p>{known?.text ?? `keyloom couldn't draw this board. ${flow.previewProblem}`}</p>
      {flow.previewUnexpected === undefined ? (
        <button type="button" className="sheet-action" onClick={flow.retryPreview}><RefreshCw size={13} aria-hidden="true" />Try again</button>
      ) : (
        <p className="nb-actions"><UnexpectedWayOut token={flow.token} code={flow.previewUnexpected} onRetry={flow.retryPreview} className="sheet-action" /></p>
      )}
    </div>
  );
}

function Confirm({ flow, preview, known: ways }: { flow: NewKeyboard; preview: PreviewResponse | null; known: KnownWays }) {
  const step = flow.step;
  if (step.kind !== "confirm") return null;
  const rows = preview?.rows.length ?? 0;
  const homeRow = step.homeRow ?? preview?.guessedHomeRow ?? null;
  const needsController = (preview?.controllers.length ?? 0) > 0;
  const layouts = preview?.layouts ?? [];
  const asked = 1 + (layouts.length > 1 ? 1 : 0) + (needsController ? 1 : 0);
  const name = preview?.displayName ?? step.candidate.name;
  const problem = preview === null ? null : deriveProblem(preview.boardProblemCode, name);
  // The board is drawn on keyloom's guess until the person picks a layout, and a guess is never added (D-525).
  const layoutPending = preview !== null && layoutUnpicked(step, preview);
  const cantAdd = problem?.blocked === true || (preview === null && (knownBoard(flow) || deriveProblem(flow.previewProblemCode, name)?.blocked === true));
  let number = 0;
  // Nothing is drawn for a keyboard keyloom has, so the heading says that instead of how its firmware draws it (R6-07).
  const known = preview === null && knownBoard(flow);
  return (
    <section className="nb-panel" aria-label="Confirm the keyboard">
      <header className="nb-panel-head">
        <button type="button" className="sheet-action nb-back" onClick={flow.backToCard}><ArrowLeft size={13} aria-hidden="true" />Candidates</button>
        <h2>{known ? `keyloom already has the ${flow.previewProblemBoard?.name ?? name}` : `Your ${name}, as ${step.candidate.firmware === "zmk" ? "ZMK" : "QMK"} draws it`}</h2>
        {known ? null : <p className="nb-lead">{preview === null ? (flow.previewProblem === null ? "Reading its layout from the firmware's own tree…" : "keyloom reads its layout from the firmware's own tree.") : cantAdd ? `${preview.keyCount} keys from the firmware's own layout.` : `${preview.keyCount} keys from the firmware's own layout. ${["One thing", "Two things", "Three things"][asked - 1]} can't be read over USB; tell keyloom once.`}</p>}
      </header>
      <div className="nb-panel-body">
        {preview === null ? <Reading flow={flow} name={name} known={ways} /> : cantAdd && problem !== null ? (
          // Nothing asked here could get this keyboard added, so the questions wait until keyloom can (R5-06).
          <CantAdd flow={flow} problem={problem} />
        ) : (
          <>
            {layouts.length > 1 ? (
              // A third of QMK's keyboards have several layouts and no default (R5-06): the person picks theirs, by its key count.
              <div className="nb-step">
                <h3><span>{++number}</span>Which layout is yours?</h3>
                <p>QMK lists {layouts.length} layouts for the {step.candidate.name}. Pick the one with your number of keys; the board shows each one as you pick it.{preview.guessedLayout === null ? "" : " keyloom's guess is marked."}</p>
                <ChoiceGroup legend="Layout" legendHidden variant="list" value={step.layout ?? (layoutPending ? null : preview.layout)}
                  choices={layouts.map((l) => ({ value: l.name, label: `${l.name} · ${plural(l.keys, "key")}${l.name === preview.guessedLayout ? " · guess" : ""}` }))}
                  onChange={flow.setLayout} />
              </div>
            ) : null}
            {/* Picking a layout resets the home row to keyloom's guess for it, so the home row waits for the layout (R6-13). */}
            {layoutPending ? null : (
              <div className="nb-step">
                <h3><span>{++number}</span>Where do your fingers rest?</h3>
                <p>Click any key in that row on the board, or pick it here. keyloom's guess is marked.</p>
                <ChoiceGroup legend="Home row" legendHidden variant="pills" value={homeRow === null ? null : String(homeRow)}
                  choices={preview.rows.map((r) => ({ value: String(r.row), label: `${rowWord(r.row, rows)}${r.row === preview.guessedHomeRow ? " · guess" : ""}` }))}
                  onChange={(row) => flow.setHomeRow(Number(row))} />
              </div>
            )}
            {needsController ? (
              <div className="nb-step">
                <h3><span>{++number}</span>Which controller is in it?</h3>
                <p>The {step.candidate.name} is a shield: a separate board runs it. Its name is printed on the chip under each half.</p>
                <ChoiceGroup legend="Controller" legendHidden variant="list" value={step.controller}
                  choices={preview.controllers.map((c) => ({ value: c.id, label: c.name }))} onChange={flow.setController} />
              </div>
            ) : null}
            {preview.boardProblem === null ? null : <p className="nb-problem" role="alert">{problem?.text ?? preview.boardProblem}</p>}
          </>
        )}
        {flow.problem === null ? null : <p className="nb-problem" role="alert">{flow.problem}</p>}
      </div>
      <footer className="nb-panel-foot">
        <button type="button" className="sheet-action" onClick={flow.notNow}>Not now</button>
        {/* A keyboard keyloom can't add yet has no next step; the problem above offers the guide and another keyboard (R5-06). */}
        {cantAdd ? null : (
          <button type="button" className="bar-apply" disabled={preview === null || preview.board === null || layoutPending || (needsController && step.controller === null)} onClick={flow.review}>
            {layoutPending ? "Pick your layout" : needsController && step.controller === null ? "Pick the controller" : "Show me the board"}
          </button>
        )}
      </footer>
    </section>
  );
}

function Review({ flow, preview, known }: { flow: NewKeyboard; preview: PreviewResponse | null; known: KnownWays }) {
  const step = flow.step;
  if (step.kind !== "review") return null;
  const board = preview?.board ?? null;
  const name = preview?.displayName ?? step.candidate.name;
  const controller = preview?.controllers.find((c) => c.id === step.controller)?.name ?? null;
  return (
    <section className="nb-panel" aria-label={`How keyloom reads your ${name}`}>
      <header className="nb-panel-head">
        <button type="button" className="sheet-action nb-back" onClick={flow.backToConfirm}><ArrowLeft size={13} aria-hidden="true" />{reviewBackLabel((preview?.layouts.length ?? 0) > 1, controller !== null)}</button>
        <h2>How keyloom reads your {name}</h2>
        <p className="nb-lead">Each key shows the finger keyloom expects to press it. {FINGER_LETTERS} If one is wrong, go back and pick another row or keyboard; it's cheaper now than after a flash.</p>
      </header>
      <div className="nb-panel-body">
        {board === null ? <Reading flow={flow} name={name} known={known} /> : (
          <>
            <dl className="nb-facts">
              <dt>Keys</dt><dd>{board.keys.length}{board.thumbs.length > 0 ? `, ${plural(board.thumbs.length, "thumb key")}` : ""}</dd>
              <dt>Body</dt><dd>{isOnePiece({ hands: board.hands }, board.keys) ? "One piece" : `Split: ${board.hands.left.length} and ${board.hands.right.length} keys`}</dd>
              <dt>Home row</dt><dd>{rowWord(board.homeRow, preview?.rows.length ?? 0)} (you said)</dd>
              {(preview?.layouts.length ?? 0) > 1 && step.layout !== null ? (<><dt>Layout</dt><dd>{step.layout}</dd></>) : null}
              {controller === null ? null : (<><dt>Controller</dt><dd>{controller}</dd></>)}
              <dt>Firmware</dt><dd>{step.candidate.firmware === "zmk" ? "ZMK" : "QMK"}, from its own tree</dd>
            </dl>
            {/* A board keyloom can't add has no first flash to describe, and no sync to promise (R8-07). */}
            {flow.addBlocked === null ? <FlashWords flash={board.flash} boardName={name} /> : null}
          </>
        )}
        {/* Add refused for a reason these answers hit again: why, with the guide, and no Add that would repeat it (R7-11). */}
        {flow.addBlocked === null ? null : <CantAdd flow={flow} problem={flow.addBlocked} />}
        {flow.problem === null ? null : <p className="nb-problem" role="alert">{flow.problem}</p>}
      </div>
      <footer className="nb-panel-foot">
        <button type="button" className="sheet-action" onClick={flow.backToConfirm}>Back</button>
        {flow.addBlocked === null ? (
          <button type="button" className="bar-apply" disabled={board === null || flow.busy} onClick={() => void flow.add()}>
            {flow.busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
            Add the {name}
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function Put({ flow, sources, preview, onMade }: { flow: NewKeyboard; sources: readonly PutSource[]; preview: PutPreviewResponse | null; onMade: (configId: string) => void }) {
  const step = flow.step;
  const [filter, setFilter] = useState("");
  if (step.kind !== "put") return null;
  const behind = preview?.notCarried ?? [];
  const problems = preview?.problems ?? [];
  const placeable = preview?.placements.filter((p) => p.blocked === undefined && p.candidates.length > 0) ?? [];
  const blocked = preview?.placements.filter((p) => p.blocked !== undefined) ?? [];
  const chosenFor = (source: number, first: number) => step.choices[String(source)] ?? first;
  const needle = filter.trim().toLowerCase();
  const shown = needle === "" ? sources : sources.filter((s) => `${s.name} ${s.boardName}`.toLowerCase().includes(needle));
  const start = async () => {
    const id = await flow.startBlank(`${step.boardName} daily`, { free: true });
    if (id !== null) onMade(id);
  };
  const make = () => void flow.make().then((out) => {
    if (out !== null) onMade(out.config.id);
  });
  return (
    <section className="nb-panel" aria-label={`Put a config on the ${step.boardName}`}>
      <header className="nb-panel-head">
        <p className="nb-eyebrow nb-eyebrow-ok">{step.origin === "new" ? `Added: ${step.boardName}` : step.origin === "matched" ? `keyloom already has the ${step.boardName}` : "No config on it yet"}</p>
        {/* With no config to put on it, as on a first run, the step is starting one (R7-10). */}
        <h2>{sources.length === 0 ? `Start a config for the ${step.boardName}` : `Put a config on the ${step.boardName}`}</h2>
        {sources.length === 0 ? null : <p className="nb-lead">keyloom maps it key by key onto the {step.boardName}, as a new config. Your original stays as it is.</p>}
      </header>
      <div className="nb-panel-body">
        {sources.length > 5 ? (
          <label className="nb-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" value={filter} placeholder="Find a config" onChange={(e) => setFilter(e.target.value)} />
          </label>
        ) : null}
        {sources.length === 0 ? null : (
          <div className="nb-list" role="radiogroup" aria-label="Which config">
            {shown.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={step.source === s.id} onClick={() => flow.chooseSource(s.id)}>
                <i aria-hidden="true" />{s.name}<small>{s.boardName}{s.note === null ? "" : ` · ${s.note}`}</small>
              </button>
            ))}
          </div>
        )}
        {sources.length === 0 ? <div className="nb-blank"><p>Start a config for this keyboard, then edit its keys.</p><button type="button" className="bar-apply" disabled={flow.busy} onClick={() => void start()}>Start a config</button><p className="nb-note">Nothing is applied or flashed. Use Import instead if you already have a keymap.</p></div> : shown.length === 0 ? <p className="nb-note">No config matches “{filter}”.</p> : null}
        {/* With configs to copy, starting from the board's own keys is still a way on, for when none of them maps (R5-16). */}
        {sources.length === 0 ? null : (
          <p className="nb-note nb-start">
            Or start a config from the {step.boardName}&rsquo;s own keys.{" "}
            <button type="button" className="sheet-action" disabled={flow.busy} onClick={() => void start()}>Start a config</button>
          </p>
        )}
        {step.source === null ? sources.length === 0 ? null : <p className="nb-note">Pick one to see it on the {step.boardName}.</p> : flow.putFailure !== null ? (
          // A map that failed stops "Mapping it…" (R6-05): Try again where asking again can work, and another config. Start a config is
          // the line above, which a put with configs to pick always shows (R5-16).
          <div className="nb-problem" role="alert">
            <p>{flow.putFailure.text}</p>
            <p className="nb-actions">
              {flow.putFailure.retry ? <button type="button" className="sheet-action" onClick={flow.retryPut}><RefreshCw size={13} aria-hidden="true" />Try again</button> : null}
              <button type="button" className="sheet-action" onClick={flow.clearSource}><ArrowLeft size={13} aria-hidden="true" />Pick another config</button>
            </p>
          </div>
        ) : preview === null ? (
          <p className="nb-note"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Mapping it…</p>
        ) : (
          <>
            <p className="nb-lead"><b>{preview.summary.charAt(0).toUpperCase() + preview.summary.slice(1)}.</b>{behind.length === 0 ? "" : ` ${plural(behind.length, "key")} stay behind${mostCommon(behind)}.`}</p>
            {problems.length === 0 ? null : (
              <div className="nb-problem" role="alert">
                <b>keyloom can't make this config yet.</b> {problems[0]}
                {problems.length > 1 ? ` (${problems.length - 1} more problem${problems.length === 2 ? "" : "s"}; pick another config, or change this one and try again.)` : ""}
              </div>
            )}
            {behind.length === 0 ? null : (
              // Every key that stays behind, with why, a click away: a list that long would bury the choices below it.
              <details className="nb-behind">
                <summary>See the {plural(behind.length, "key")} that stay behind</summary>
                <ul>{behind.map((n) => <li key={`${n.layerName}:${n.source}`}><b>{n.sourceName}</b> on {niceLayerName(n.layerName)}: {n.why}</li>)}</ul>
              </details>
            )}
            <div className="nb-rows" role="table" aria-label="Layers">
              {preview.layers.map((l) => (
                <div key={l.source} role="row">
                  {/* The strip's name for the layer ("Default layer"), not the firmware's ("default_layer"). */}
                  <span role="cell">{niceLayerName(preview.after.layers.find((x) => x.id === l.target)?.name ?? l.target)}</span>
                  <span role="cell">{plural(l.carried, "key")}</span>
                  <span role="cell">{l.carried === 0 ? "all off" : l.guessed > 0 ? `${l.guessed} by nearest place` : ""}</span>
                </div>
              ))}
            </div>
            {placeable.map((p) => {
              const first = (p.candidates[0] as { target: number }).target;
              return (
                <div key={`${p.layerId}:${p.source}`} className="nb-place">
                  <b>{p.sourceName.replace(/ \(.*\)$/, "")} has no key of its own here</b>
                  <p>On the old board it's the {p.sourceName.match(/\((.*)\)$/)?.[1] ?? "key it was"}. Put it on:</p>
                  <div className="nb-chips" role="radiogroup" aria-label={`Where ${p.sourceName} goes`}>
                    {p.candidates.map((c) => (
                      <button key={c.target} type="button" role="radio" aria-checked={chosenFor(p.source, first) === c.target} onClick={() => flow.choosePlacement(p.source, c.target)}>
                        {c.name.charAt(0).toUpperCase() + c.name.slice(1)}{c.replaces === undefined ? "" : ` · replaces ${c.replaces.replace(/ \(.*\)$/, "")}`}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {blocked.length === 0 && preview.combos.copied.length + preview.combos.skipped.length === 0 ? null : (
              <p className="nb-note">
                {blocked.length === 0 ? "" : `${plural(blocked.length, "more layer key")} can't be placed: ${blocked[0]?.blocked ?? ""}. `}
                {preview.combos.copied.length === 0 ? "" : `${plural(preview.combos.copied.length, "combo")} come along. `}
                {preview.combos.skipped.length === 0 ? "" : `${preview.combos.skipped.length} stay: ${preview.combos.skipped[0]?.why ?? ""}.`}
              </p>
            )}
          </>
        )}
        {/* Only a config being made carries activities, and a kanata board has no firmware to test them on (R1-13). */}
        {preview === null || preview.after.firmware === "kanata" ? null : (
          <div className="br-workloads">
            <ActivityChoices value={flow.activities} onChange={flow.setActivities} disabled={flow.busy} />
            <p className="nb-note">Optional: after you apply the copied keys, test these US-ANSI samples and check suggestions against them. Needs Docker; may download firmware and take several minutes. Nothing is flashed by a test.</p>
          </div>
        )}
        {flow.removed === null ? null : (
          <RestoreKeyboard restore={() => flow.restoreKeyboard(step.boardId)} boardName={step.boardName} doing={flow.removed === "make" ? "make this config" : "start a config"}
            onRestored={() => (flow.removed === "make" ? make() : start())} />
        )}
        {flow.problem === null ? null : <p className="nb-problem" role="alert">{flow.problem}</p>}
      </div>
      <footer className="nb-panel-foot">
        <span className="nb-note">Nothing is applied yet.</span>
        <button type="button" className="sheet-action" onClick={flow.close}>Later</button>
        {/* No config to pick: Start a config, above, is the way on, so there is no Make to wait on (R7-10). */}
        {sources.length === 0 ? null : (
          <button
            type="button"
            className="bar-apply"
            disabled={preview === null || problems.length > 0 || flow.busy}
            onClick={make}
          >
            {flow.busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
            {preview !== null ? problems.length > 0 ? "Can't make this config" : `Make “${preview.name}”` : step.source === null ? "Pick a config" : flow.putFailure !== null ? "Can't map this config" : "Mapping it…"}
          </button>
        )}
      </footer>
    </section>
  );
}
