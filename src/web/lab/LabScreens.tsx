import { ArrowLeft, LoaderCircle, Play, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { FingerReadout, LabReadout } from "../../api/lab.ts";
import type { ProposalCard } from "../../api/http.ts";
import { formatWhen } from "../history/words.ts";
import type { Lab } from "./useLab.ts";
import "./lab.css";

const FINGER_ORDER = ["left-pinky", "left-ring", "left-middle", "left-index", "left-thumb", "right-thumb", "right-index", "right-middle", "right-ring", "right-pinky"];
const fingerWords = (f: string) => f.replace("-", " ");

/** A recording's minutes and seconds, as the pill says it. */
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

// ---------------------------------------------------------------------------------------------------------------------------------
// Over the stage: choosing a passage, the passage while listening, and reading it back (l1, l2 in the comps).

export function LabStage({ lab, boardName, phone, onClose, onType }: { lab: Lab; boardName: string; phone: boolean; onClose: () => void; onType: (ch: string) => void }) {
  const { phase } = lab;
  if (phase.kind === "start") return <StartCard lab={lab} boardName={boardName} phone={phone} onClose={onClose} />;
  if (phase.kind === "listening") return <Listening lab={lab} boardName={boardName} startedAt={phase.startedAt} text={phase.passage.text} onType={onType} />;
  if (phase.kind === "reading") {
    return (
      <div className="lab-pill-row">
        <span className="lab-pill"><LoaderCircle size={13} className="spin" aria-hidden="true" />Playing your typing back through the board…</span>
      </div>
    );
  }
  return null;
}

function StartCard({ lab, boardName, phone, onClose }: { lab: Lab; boardName: string; phone: boolean; onClose: () => void }) {
  const [choice, setChoice] = useState<string>("starter");
  const [own, setOwn] = useState("");
  // The built-in passages: the starter, home row rolls and holds, each finger on its own, and BK's own text.
  const offered = ["starter", "home-row-rolls", "home-row-holds", "finger-drill"].flatMap((id) => lab.passages.filter((p) => p.id === id));
  const shown = offered.length > 0 ? offered : lab.passages.slice(0, 4);
  useEffect(() => {
    if (shown[0] !== undefined && !shown.some((p) => p.id === choice) && choice !== "own") setChoice(shown[0].id);
  }, [shown, choice]);
  const canRecord = lab.canRecord.ok && !phone;
  return (
    <section className="lab-card lab-start" aria-label="Typing lab">
      <header className="lab-head">
        <h2>Typing lab</h2>
        <button type="button" className="sheet-close" aria-label="Close the typing lab" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </header>
      {canRecord ? (
        <p className="lab-lead">Type a passage for two to five minutes. keyloom listens to your {boardName} only while this screen is open, then shows what your hands do, finger by finger, and fixes it has tried on your typing. Nothing leaves your Mac.</p>
      ) : (
        <p className="lab-lead">{phone ? "Typing lab needs a keyboard plugged into this Mac. Here you can read past sessions." : lab.canRecord.why}</p>
      )}
      {canRecord ? (
        <>
          <div className="lab-choices" role="radiogroup" aria-label="What to type">
            {shown.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={choice === p.id} className="lab-choice" onClick={() => setChoice(p.id)}>
                <strong>{p.id === "finger-drill" ? "How fast is each finger" : p.title}</strong>
                <span>{p.why}</span>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={choice === "own"} className="lab-choice" onClick={() => setChoice("own")}>
              <strong>Your own text</strong>
              <span>Paste something you write.</span>
            </button>
          </div>
          {choice === "own" ? <textarea className="lab-own" aria-label="Your own text" value={own} placeholder="Paste a paragraph you'd normally type" onChange={(e) => setOwn(e.target.value)} /> : null}
          <div className="lab-actions">
            <span className="lab-note">Don't type passwords here. Recording stops if you leave this screen.</span>
            <button type="button" className="sheet-action" onClick={onClose}>Not now</button>
            <button type="button" className="bar-apply" disabled={choice === "own" && own.trim() === ""} onClick={() => void lab.start(choice === "own" ? { text: own } : { passageId: choice })}>
              Start listening
            </button>
          </div>
        </>
      ) : null}
      {lab.problem === null ? null : <p className="lab-problem" role="alert">{lab.problem}</p>}
      {lab.sessions.length === 0 ? null : (
        <div className="lab-past">
          <h3>Earlier sessions</h3>
          <ul>
            {lab.sessions.slice(0, 3).map((s) => (
              <li key={s.id}>
                <button type="button" className="lab-past-row" onClick={() => void lab.showSession(s.id, false)}>
                  <span>{formatWhen(s.startedAt, Date.now())}</span>
                  <span className="lab-note">{clock(s.endedAt - s.startedAt)} · {s.analysed ? "read" : "not read yet"}</span>
                </button>
                <button type="button" className="sheet-close" aria-label="Delete this session" onClick={() => void lab.remove(s.id)}><Trash2 size={14} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Listening({ lab, boardName, startedAt, text, onType }: { lab: Lab; boardName: string; startedAt: number; text: string; onType: (ch: string) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    input.current?.focus();
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  // What's typed is ink, the rest of the passage grey; the box itself is invisible, so the passage is what's read.
  const done = text.slice(0, lab.typed.length);
  const rest = text.slice(lab.typed.length);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") void lab.cancel();
    else if (e.key.length === 1) onType(e.key.toLowerCase());
  };
  return (
    <div className="lab-listening">
      <p className="lab-passage" aria-hidden="true">
        <span className="lab-passage-done">{done}</span>
        <span className="lab-caret" />
        <span>{rest}</span>
      </p>
      <textarea
        ref={input}
        className="lab-typing"
        aria-label="Type the passage"
        value={lab.typed}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => lab.setTyped(e.target.value)}
        onKeyDown={onKey}
        // Leaving the box stops listening, so a password typed elsewhere is never recorded (24#privacy).
        onBlur={() => void lab.stop()}
      />
      <div className="lab-pill-row">
        <span className="lab-pill" role="status">
          <i className="lab-rec" aria-hidden="true" />
          Listening to your {boardName}
          <span className="lab-sep">·</span>
          {clock(now - startedAt)}
          <span className="lab-sep">·</span>
          <button type="button" className="lab-stop" onMouseDown={(e) => e.preventDefault()} onClick={() => void lab.stop()}>Stop</button>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Beside the board: what your hands do, one finding, or a fix being tried (l3 to l5).

export function LabPanel({ lab, heat, onHeat, onTry, onApply, onClose }: {
  lab: Lab;
  heat: "speed" | "errors";
  onHeat: (mode: "speed" | "errors") => void;
  onTry: (proposal: ProposalCard | null) => void;
  onApply: (proposal: ProposalCard) => Promise<void>;
  onClose: () => void;
}) {
  const { phase } = lab;
  if (phase.kind !== "readout") return null;
  const { readout, session } = phase;
  if (phase.trying !== null) {
    const s = readout.suggestions[phase.trying];
    if (s !== undefined) return <TryFix suggestion={s} onBack={() => { lab.tryFix(null); onTry(null); }} onApply={onApply} />;
  }
  const drill = readout.passageId === "finger-drill";
  const fingers = <Fingers readout={readout} heat={heat} onHeat={onHeat} />;
  // The per-finger findings are what the headline and the fingers block already say; listing them again would bury the misfires.
  const findings = readout.findings.filter((f) => f.kind !== "slow-finger" && f.kind !== "errors-by-finger");
  return (
    <section className="lab-panel" aria-label="What your hands do">
      <header className="lab-head">
        <div>
          <h2>What your hands do</h2>
          <p className="lab-lead">From {clock(session.endedAt - session.startedAt)} of typing, {formatWhen(session.startedAt, Date.now()).toLowerCase()} · {readout.presses} keys</p>
        </div>
        <button type="button" className="sheet-close" aria-label="Close the typing lab" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="lab-body">
        {/* Per finger is the headline (D-314): the sentence naming the slowest and the most error-prone finger comes first. After a
            finger drill the fingers block follows it (BK: "test how fast each finger is"); otherwise the misfires do. */}
        <p className="lab-headline">{readout.fingersLead}</p>
        {drill ? fingers : null}
        {findings.length === 0 ? <p className="lab-note">Nothing went wrong with the timing in this recording.</p> : null}
        <ul className="lab-findings">
          {findings.map((f) => (
            <li key={f.id}>
              <button type="button" className="lab-finding" aria-expanded={phase.open === f.id} onClick={() => lab.openFinding(phase.open === f.id ? null : f.id)}>
                {f.positions.length > 0 ? <i className="lab-dot" aria-hidden="true" /> : null}
                <span>{f.sentence}</span>
              </button>
              {phase.open === f.id ? <FindingMore positions={f.positions} suggestions={readout.suggestions} onTry={(i) => { lab.tryFix(i); onTry(readout.suggestions[i]?.proposal ?? null); }} /> : null}
            </li>
          ))}
        </ul>
        {drill ? null : fingers}
        {readout.suggestions.length === 0 ? null : (
          <div className="lab-fixes">
            <h3>Fixes keyloom tried on your typing</h3>
            {readout.suggestions.map((s, i) => (
              <div key={s.title} className="lab-fix">
                <p><strong>{s.title}</strong></p>
                <p className="lab-note">{s.removed} of {s.before} misfires gone, {s.introduced === 0 ? "none new" : `${s.introduced} new`}</p>
                {/* A fix the layout's checks refused can't be applied, so it says so instead of offering a dead button; the reason is in the notes. */}
                {s.proposal === null
                  ? <p className="lab-note">It can't go on your layout as it is now; the note below says why.</p>
                  : <button type="button" className="bar-apply" onClick={() => { lab.tryFix(i); onTry(s.proposal); }}>Try the fix</button>}
              </div>
            ))}
          </div>
        )}
        {readout.notes.length === 0 ? null : <p className="lab-note">{readout.notes.join(" ")}</p>}
      </div>
      <footer className="lab-foot">
        <button type="button" className="sheet-action" onClick={lab.again}><Play size={13} aria-hidden="true" />Type again</button>
      </footer>
    </section>
  );
}

/** The fingers block (D-314): one sentence naming the slowest and the most error-prone finger, then each finger's speed and errors. */
function Fingers({ readout, heat, onHeat }: { readout: LabReadout; heat: "speed" | "errors"; onHeat: (m: "speed" | "errors") => void }) {
  // All ten fingers, so a finger the passage never used reads as such instead of going missing.
  const rows = FINGER_ORDER.map((f) => readout.fingers.find((r) => r.finger === f) ?? null);
  const slowest = Math.max(1, ...rows.map((r) => r?.medianMs ?? 0));
  return (
    <div className="lab-fingers">
      <div className="lab-fingers-head">
        <h3>Your fingers</h3>
        <div className="lab-toggle" role="radiogroup" aria-label="What the board shows">
          {(["speed", "errors"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={heat === m} onClick={() => onHeat(m)}>{m === "speed" ? "Speed" : "Errors"}</button>
          ))}
        </div>
      </div>
      <ol className="lab-finger-rows">
        {rows.map((r: FingerReadout | null, i) => r === null ? (
          <li key={FINGER_ORDER[i]} className="lab-finger-unused">
            <span className="lab-finger-name">{fingerWords(FINGER_ORDER[i] as string)}</span>
            <span className="lab-bar" aria-hidden="true" />
            <span className="lab-num">–</span>
            <span className="lab-num">not typed</span>
          </li>
        ) : (
          <li key={r.finger}>
            <span className="lab-finger-name">{fingerWords(r.finger)}</span>
            <span className="lab-bar" aria-hidden="true"><i style={{ width: `${(r.medianMs / slowest) * 100}%` }} /></span>
            <span className="lab-num">{r.medianMs === 0 ? "–" : `${Math.round(r.medianMs)} ms`}</span>
            <span className="lab-num" title={`${r.typos} typos, ${r.misfires} misfires`}>{r.errors === 0 ? "no errors" : `${r.errors} ${r.errors === 1 ? "error" : "errors"}`}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One misfire slowed down: how long the held key was down, when the next key went down inside it, and where the tapping term falls. */
function Timeline({ example: e }: { example: NonNullable<LabReadout["suggestions"][number]["example"]> }) {
  const span = Math.max(e.heldMs, (e.termMs ?? 0) + 60);
  const pct = (ms: number) => `${(ms / span) * 100}%`;
  return (
    <div className="lab-example">
      <p className="lab-note">One of them, slowed down: {e.held} still down {e.overlapMs} ms after {e.next ?? "the next key"}.</p>
      <div className="lab-timeline" aria-hidden="true">
        <span className="lab-tbar lab-tbar-held" style={{ left: 0, width: pct(e.heldMs) }}>{e.held} held</span>
        {e.next === null ? null : <span className="lab-tbar" style={{ left: pct(Math.max(0, e.heldMs - e.overlapMs - 40)), width: pct(40) }}>{e.next}</span>}
        {e.termMs === null ? null : <span className="lab-term" style={{ left: pct(e.termMs) }}><span>{e.termMs} ms</span></span>}
      </div>
    </div>
  );
}

/** A finding opened (l2): one of its misfires slowed down, and the fixes keyloom tried on those keys. */
function FindingMore({ positions, suggestions, onTry }: { positions: number[]; suggestions: LabReadout["suggestions"]; onTry: (index: number) => void }) {
  const related = suggestions.flatMap((s, i) => (s.example !== null && positions.includes(s.example.position) ? [{ s, i }] : []));
  const example = related.find(({ s }) => s.example !== null)?.s.example ?? null;
  if (related.length === 0) return null;
  return (
    <div className="lab-finding-more">
      {example === null ? null : <Timeline example={example} />}
      {related.map(({ s, i }) => (
        <div key={s.title} className="lab-fix">
          <p><strong>{s.title}</strong></p>
          <p className="lab-note">{s.removed} of {s.before} misfires gone, {s.introduced === 0 ? "none new" : `${s.introduced} new`}</p>
          {s.proposal === null ? null : <button type="button" className="bar-apply" onClick={() => onTry(i)}>Try the fix</button>}
        </div>
      ))}
    </div>
  );
}

function TryFix({ suggestion: s, onBack, onApply }: { suggestion: LabReadout["suggestions"][number]; onBack: () => void; onApply: (p: ProposalCard) => Promise<void> }) {
  const [applying, setApplying] = useState(false);
  const e = s.example;
  return (
    <section className="lab-panel" aria-label={s.title}>
      <header className="lab-head">
        <div>
          <button type="button" className="sheet-action lab-back" onClick={onBack}><ArrowLeft size={13} aria-hidden="true" />What your hands do</button>
          <h2>{s.title}</h2>
          <p className="lab-lead">Your recording, played back through the board with this change, before you change anything.</p>
        </div>
      </header>
      <div className="lab-body">
        <div className="lab-count" role="table" aria-label="Before and after">
          <span />
          <span className="lab-note">Before</span>
          <span className="lab-note">After</span>
          <span />
          <span>Misfires on these keys</span>
          <span className="lab-num">{s.before}</span>
          <span className="lab-num">{s.after}</span>
          <span className="lab-gone">{s.removed} gone</span>
          <span>New misfires</span>
          <span className="lab-num">0</span>
          <span className="lab-num">{s.introduced}</span>
          <span className="lab-note">{s.introduced === 0 ? "none" : "new"}</span>
        </div>
        {e === null ? null : <Timeline example={e} />}
        {s.proposal === null ? null : <p className="lab-explain">{s.proposal.explanation}</p>}
      </div>
      <footer className="lab-foot">
        <button type="button" className="sheet-action" onClick={onBack}>Not this</button>
        <button
          type="button"
          className="bar-apply"
          disabled={s.proposal === null || applying}
          onClick={() => {
            if (s.proposal === null) return;
            setApplying(true);
            void onApply(s.proposal).finally(() => setApplying(false));
          }}
        >
          {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
          Apply
        </button>
      </footer>
    </section>
  );
}
