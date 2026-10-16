import { ArrowLeft, LoaderCircle, Zap } from "lucide-react";
import type { PreviewResponse, PutPreviewResponse } from "../../api/keyboards.ts";
import type { NewKeyboard } from "./useNewKeyboard.ts";
import "./keyboards.css";

export type PutSource = { id: string; name: string; boardName: string; note: string | null };

const ROW_WORDS = ["Top row", "Second row", "Third row", "Fourth row", "Fifth row", "Sixth row"];
/** "Top row", "Middle row" and "Bottom row" on a three-row board; counted from the top on others. */
function rowWord(row: number, rows: number): string {
  if (rows === 3) return ["Top row", "Middle row", "Bottom row"][row - 1] ?? `Row ${row}`;
  if (row === rows) return "Bottom row";
  return ROW_WORDS[row - 1] ?? `Row ${row}`;
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
          <b>keyloom won't flash from here.</b> The first flash is by hand: Build and flash, then {flash.steps.length > 1 ? "on each half, " : ""}
          {(flash.steps[0] ?? "put the keyboard in its bootloader when it asks").replace(/^Plug in the (left|right) half and /i, "").replace(/\.$/, "").toLowerCase()} when it asks.
          After that first one, keyloom can sync your {boardName} for you.
        </p>
      )}
    </div>
  );
}

// The side column of the new-keyboard flow (n2 to n4, D-336): the two questions USB can't answer, the board as keyloom read it, and
// putting a config on it. Every choice is a visible button or row; the board beside it shows each one as it is made.
export function NewBoardPanel({ flow, sources, onMade }: { flow: NewKeyboard; sources: readonly PutSource[]; onMade: (configId: string) => void }) {
  const { step, preview } = flow;
  if (step.kind === "confirm") return <Confirm flow={flow} preview={preview} />;
  if (step.kind === "review") return <Review flow={flow} preview={preview} />;
  if (step.kind === "put") return <Put flow={flow} sources={sources} preview={flow.putPreview} onMade={onMade} />;
  return null;
}

function Confirm({ flow, preview }: { flow: NewKeyboard; preview: PreviewResponse | null }) {
  const step = flow.step;
  if (step.kind !== "confirm") return null;
  const rows = preview?.rows.length ?? 0;
  const homeRow = step.homeRow ?? preview?.guessedHomeRow ?? null;
  const needsController = (preview?.controllers.length ?? 0) > 0;
  return (
    <section className="nb-panel" aria-label="Confirm the keyboard">
      <header className="nb-panel-head">
        <button type="button" className="sheet-action nb-back" onClick={flow.backToCard}><ArrowLeft size={13} aria-hidden="true" />Candidates</button>
        <h2>Your {preview?.displayName ?? step.candidate.name}, as {step.candidate.firmware === "zmk" ? "ZMK" : "QMK"} draws it</h2>
        <p className="nb-lead">{preview === null ? "Reading its layout from the firmware's own tree…" : `${preview.keyCount} keys from the firmware's own layout. ${needsController ? "Two things" : "One thing"} can't be read over USB; tell keyloom once.`}</p>
      </header>
      <div className="nb-panel-body">
        {preview === null ? <p className="nb-note"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Reading…</p> : (
          <>
            <div className="nb-step">
              <h3><span>1</span>Where do your fingers rest?</h3>
              <p>Click any key in that row on the board, or pick it here. keyloom's guess is marked.</p>
              <div className="nb-seg" role="radiogroup" aria-label="Home row">
                {preview.rows.map((r) => (
                  <button key={r.row} type="button" role="radio" aria-checked={homeRow === r.row} onClick={() => flow.setHomeRow(r.row)}>
                    {rowWord(r.row, rows)}{r.row === preview.guessedHomeRow ? <small> · guess</small> : null}
                  </button>
                ))}
              </div>
            </div>
            {needsController ? (
              <div className="nb-step">
                <h3><span>2</span>Which controller is in it?</h3>
                <p>The {step.candidate.name} is a shield: a separate board runs it. Its name is printed on the chip under each half.</p>
                <div className="nb-list" role="radiogroup" aria-label="Controller">
                  {preview.controllers.map((c) => (
                    <button key={c.id} type="button" role="radio" aria-checked={step.controller === c.id} onClick={() => flow.setController(c.id)}>
                      <i aria-hidden="true" />{c.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {preview.boardProblem === null ? null : <p className="nb-problem" role="alert">{preview.boardProblem}</p>}
          </>
        )}
        {flow.problem === null ? null : <p className="nb-problem" role="alert">{flow.problem}</p>}
      </div>
      <footer className="nb-panel-foot">
        <button type="button" className="sheet-action" onClick={flow.notNow}>Not now</button>
        <button type="button" className="bar-apply" disabled={preview === null || preview.board === null || (needsController && step.controller === null)} onClick={flow.review}>
          {needsController && step.controller === null ? "Pick the controller" : "Show me the board"}
        </button>
      </footer>
    </section>
  );
}

function Review({ flow, preview }: { flow: NewKeyboard; preview: PreviewResponse | null }) {
  const step = flow.step;
  if (step.kind !== "review") return null;
  const board = preview?.board ?? null;
  const name = preview?.displayName ?? step.candidate.name;
  const controller = preview?.controllers.find((c) => c.id === step.controller)?.name ?? null;
  return (
    <section className="nb-panel" aria-label={`How keyloom reads your ${name}`}>
      <header className="nb-panel-head">
        <button type="button" className="sheet-action nb-back" onClick={flow.backToConfirm}><ArrowLeft size={13} aria-hidden="true" />Home row{controller === null ? "" : " and controller"}</button>
        <h2>How keyloom reads your {name}</h2>
        <p className="nb-lead">Each key shows the finger keyloom expects to press it. If one is wrong, go back and pick another row or keyboard; it's cheaper now than after a flash.</p>
      </header>
      <div className="nb-panel-body">
        {board === null ? <p className="nb-note"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Reading…</p> : (
          <>
            <dl className="nb-facts">
              <dt>Keys</dt><dd>{board.keys.length}{board.thumbs.length > 0 ? `, ${plural(board.thumbs.length, "thumb key")}` : ""}</dd>
              <dt>Halves</dt><dd>Split at the widest gap: {board.hands.left.length} and {board.hands.right.length}</dd>
              <dt>Home row</dt><dd>{rowWord(board.homeRow, preview?.rows.length ?? 0)} (you said)</dd>
              {controller === null ? null : (<><dt>Controller</dt><dd>{controller}</dd></>)}
              <dt>Firmware</dt><dd>{step.candidate.firmware === "zmk" ? "ZMK" : "QMK"}, from its own tree</dd>
            </dl>
            <FlashWords flash={board.flash} boardName={name} />
          </>
        )}
        {flow.problem === null ? null : <p className="nb-problem" role="alert">{flow.problem}</p>}
      </div>
      <footer className="nb-panel-foot">
        <button type="button" className="sheet-action" onClick={flow.backToConfirm}>Back</button>
        <button type="button" className="bar-apply" disabled={board === null || flow.busy} onClick={() => void flow.add()}>
          {flow.busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
          Add the {name}
        </button>
      </footer>
    </section>
  );
}

function Put({ flow, sources, preview, onMade }: { flow: NewKeyboard; sources: readonly PutSource[]; preview: PutPreviewResponse | null; onMade: (configId: string) => void }) {
  const step = flow.step;
  if (step.kind !== "put") return null;
  const behind = preview?.notCarried ?? [];
  const placeable = preview?.placements.filter((p) => p.blocked === undefined && p.candidates.length > 0) ?? [];
  const blocked = preview?.placements.filter((p) => p.blocked !== undefined) ?? [];
  const chosenFor = (source: number, first: number) => step.choices[String(source)] ?? first;
  return (
    <section className="nb-panel" aria-label={`Put a config on the ${step.boardName}`}>
      <header className="nb-panel-head">
        <p className="nb-eyebrow nb-eyebrow-ok">Added: {step.boardName}</p>
        <h2>Put a config on the {step.boardName}</h2>
        <p className="nb-lead">keyloom maps it key by key onto the {step.boardName}, as a new config. Your original stays as it is.</p>
      </header>
      <div className="nb-panel-body">
        <div className="nb-list" role="radiogroup" aria-label="Which config">
          {sources.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={step.source === s.id} onClick={() => flow.chooseSource(s.id)}>
              <i aria-hidden="true" />{s.name}<small>{s.boardName}{s.note === null ? "" : ` · ${s.note}`}</small>
            </button>
          ))}
        </div>
        {step.source === null ? <p className="nb-note">Pick one to see it on the {step.boardName}.</p> : preview === null ? (
          <p className="nb-note"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Mapping it…</p>
        ) : (
          <>
            <p className="nb-lead"><b>{preview.summary.charAt(0).toUpperCase() + preview.summary.slice(1)}.</b>{behind.length === 0 ? "" : ` ${plural(behind.length, "key")} stay behind${mostCommon(behind)}.`}</p>
            {behind.length === 0 ? null : (
              // Every key that stays behind, with why, a click away: a list that long would bury the choices below it.
              <details className="nb-behind">
                <summary>See the {plural(behind.length, "key")} that stay behind</summary>
                <ul>{behind.map((n) => <li key={`${n.layerName}:${n.source}`}><b>{n.sourceName}</b> on {n.layerName}: {n.why}</li>)}</ul>
              </details>
            )}
            <div className="nb-rows" role="table" aria-label="Layers">
              {preview.layers.map((l) => (
                <div key={l.source} role="row">
                  <span role="cell">{preview.after.layers.find((x) => x.id === l.target)?.name ?? l.target}</span>
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
        {flow.problem === null ? null : <p className="nb-problem" role="alert">{flow.problem}</p>}
      </div>
      <footer className="nb-panel-foot">
        <span className="nb-note">Nothing is applied yet.</span>
        <button type="button" className="sheet-action" onClick={flow.close}>Later</button>
        <button
          type="button"
          className="bar-apply"
          disabled={preview === null || flow.busy}
          onClick={() => void flow.make().then((out) => {
            if (out !== null) onMade(out.config.id);
          })}
        >
          {flow.busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
          {preview === null ? "Pick a config" : `Make “${preview.name}”`}
        </button>
      </footer>
    </section>
  );
}
