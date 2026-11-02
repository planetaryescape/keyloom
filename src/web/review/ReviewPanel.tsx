import { Check, CircleCheck, FileText, Layers, LoaderCircle, X } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import type { ProposalCard } from "../../api/http.ts";
import type { BoardReview } from "../../api/review.ts";
import type { Layout } from "../../layout/schema.ts";
import { fixableFindings, type FixedItem, type ReviewItem } from "../../validation/review-item.ts";
import { describeKey } from "../../layout/describe.ts";
import { layerName } from "../chat/proposal-facts.ts";
import { formatWhen } from "../history/words.ts";
import { MiniCap } from "../shell/Sheet.tsx";
import { ProviderPicker } from "../chat/ProviderPicker.tsx";
import { activeProviderReady } from "../chat/provider-ready.ts";
import { useProviderStatus } from "../chat/useProviderStatus.ts";
import { fixesFor, grouped, markerWords, placeOf, placeWords, segments } from "./review-words.ts";
import { FixIssuesButton } from "./FixIssues.tsx";
import type { Review } from "./useReview.ts";
import { SuggestionTestResults, WorkloadTests } from "./WorkloadTests.tsx";
import "./review.css";

type Rows = Readonly<Record<string, readonly number[]>>;

/**
 * A title or body with its keys drawn as caps and its layers as chips (D-340). A key with no legend would be a cap that says nothing,
 * so it reads as where it is instead ("an empty key on the function row"); the board marks it.
 */
export function ReviewText({ text, layout, rows }: { text: string; layout: Pick<Layout, "layers" | "macros" | "tapDances" | "passthrough">; rows: Rows }) {
  return (
    <>
      {segments(text).map((s, i) => {
        if (s.kind === "text") return <Fragment key={i}>{s.text}</Fragment>;
        if (s.kind === "layer") return <span key={i} className="br-layer"><Layers size={11} aria-hidden="true" />{layerName(layout as Layout, s.layerId)}</span>;
        const layerIndex = layout.layers.findIndex((l) => l.id === s.layerId);
        const tap = layerIndex < 0 ? "" : (describeKey(layout as Layout, layerIndex, s.position)?.legend.tap ?? "");
        return tap === "" ? <Fragment key={i}>{layerIndex < 0 ? "a key" : "an empty key"} {placeOf(s.position, rows)}</Fragment> : <MiniCap key={i}>{tap}</MiniCap>;
      })}
    </>
  );
}

// The check's own sentence names its empty keys one by one, which as caps would all read "empty"; where they are says more.
function bodyOf(item: ReviewItem, rows: Rows): string {
  if (item.source !== "check" || item.code !== "keys_do_nothing" || item.keys.length === 0) return item.body;
  const where = placeWords(item.keys.map((k) => k.position), rows);
  return item.keys.length === 1 ? `It's ${where}. Pressing it types nothing.` : `${where[0]?.toUpperCase()}${where.slice(1)}. Pressing them types nothing.`;
}

const TRIGGER: Record<BoardReview["trigger"], string> = { connect: "when it connected", apply: "after your change", import: "when it was imported", manual: "when you asked" };

// The board review in the side column (D-340): Problems, then Suggestions, then Hints, in plain words with keys as caps. Every action is
// a visible button. A suggestion is a ready proposal: pin it to see it on the board, apply it, or say not this.
export function ReviewPanel({ token, review: r, layout, rows, boardName, configName, proposals, pinnedId, onPin, onApply, onShowLayer, onFixIssues, onClose }: {
  token: string;
  review: Review;
  layout: Layout;
  /** The board's rows, to say where a key with no legend is. */
  rows: Rows;
  boardName: string;
  configName: string;
  /** The config's open proposals, for a suggestion's card. */
  proposals: readonly ProposalCard[] | null;
  pinnedId: string | null;
  onPin: (card: ProposalCard) => void;
  onApply: (card: ProposalCard) => Promise<void>;
  onShowLayer: (layerId: string) => void;
  /** Opens the chat on this config with one request that fixes what the review found (D-461). */
  onFixIssues: () => void;
  onClose: () => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const [details, setDetails] = useState(false);
  const [picking, setPicking] = useState(false);
  const provider = useProviderStatus(token);
  const [applying, setApplying] = useState<string | null>(null);
  const review = r.review;
  const loading = !r.loaded || r.refreshing || review?.ai.status === "pending" || review?.ai.status === "running";
  const readFailed = loading && r.problem !== null;
  const now = Date.now();
  const card = (item: ReviewItem) => (item.proposalId === null ? undefined : proposals?.find((p) => p.changeSetId === item.proposalId && p.status === "proposed"));
  const workloadTests = <WorkloadTests key={JSON.stringify(r.activities)} activities={r.activities} evidence={review?.workload} busy={r.busy || review?.ai.status === "running"} onRun={(activities) => void r.run(true, activities)} />;

  const head = (
    <header className="br-head">
      <div>
        <p className="br-eyebrow"><FileText size={13} aria-hidden="true" />
          {readFailed ? "Review unavailable" : loading ? "Looking over this config" : review === null ? "Not looked over yet" : r.stale ? "Review out of date" : `keyloom looked it over · ${TRIGGER[review.trigger]}, ${formatWhen(review.checkedAt, now).replace(/^(Today|Yesterday|Just now)/, (w) => w.toLowerCase())}`}
        </p>
        <h2>{readFailed ? `Your ${boardName}, review unavailable` : loading ? `Looking over your ${boardName}` : `Your ${boardName}, looked over`}</h2>
        <p className="br-lead">
          {readFailed ? "The last results are withheld until this config's review can be read." : loading ? `Checking ${configName}. Findings and suggestions will appear when this review finishes.` : r.stale ? review?.freshness?.reason ?? "These checks cover an earlier version. Run a fresh review before using suggestions." : `Source checks for ${configName}. It looks again after changes and reconnects; this is not a readback of the keyboard's full firmware.`}
        </p>
      </div>
      <button type="button" className="sheet-close" aria-label="Close the review" onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </header>
  );

  if (loading) return (
    <section className="br-panel" aria-label="Board review" aria-busy={!readFailed}>
      {head}
      <div className="br-body">
        {readFailed ? null : <p className="br-quiet br-ai-coming" role="status"><LoaderCircle size={13} className="spin" aria-hidden="true" />Looking over this config…</p>}
        <p className="br-quiet">Nothing is applied to your layout or sent to the keyboard.</p>
        {r.problem === null ? null : <><p className="br-problem" role="alert">{r.problem}</p><button type="button" className="sheet-action" onClick={r.reload}>Try loading again</button></>}
      </div>
    </section>
  );

  if (review === null) {
    return (
      <section className="br-panel" aria-label="Board review">
        {head}
        <div className="br-body">
          {workloadTests}
          <p className="br-quiet">keyloom looks a config over when its keyboard connects and after each change. This one hasn't had a look yet.</p>
          <div className="br-actions br-actions-start"><button type="button" className="bar-apply" disabled={r.busy} onClick={() => void r.run()}>{r.busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}Look it over now</button></div>
        </div>
      </section>
    );
  }

  const g = grouped(review);
  const hidden = review.items.filter((i) => i.dismissedAt !== null);
  const fixedNow = r.justFixed;
  const nothing = g.problems.length + g.suggestions.length + g.hints.length === 0;
  const stale = r.stale || undefined;

  const suggestion = (item: ReviewItem) => {
    const c = card(item);
    return (
      <article key={item.id} className="br-item" data-kind="suggestion" data-pinned={(c !== undefined && pinnedId === c.changeSetId) || undefined} data-stale={stale}>
        <h4><i className="br-kind" data-kind="suggestion" aria-hidden="true" /><ReviewText text={item.title} layout={layout} rows={rows} /></h4>
        <p><ReviewText text={bodyOf(item, rows)} layout={layout} rows={rows} /></p>
        <SuggestionTestResults baseline={review.workload?.baseline ?? []} result={review.workload?.comparisons.find((c) => c.proposalId === item.proposalId)} />
        {review.behavior?.filter((b) => b.proposalId === item.proposalId).map((b) => <details key={b.proposalId}>
          <summary>Affected behavior · {b.status === "not-tested" ? "not tested" : b.status}</summary>
          {b.checks.map((check) => <p key={check.name}><ReviewText text={check.name} layout={layout} rows={rows} />: {check.status}{check.reason ? ` — ${check.reason}` : ""}</p>)}
          {b.limitations.map((limit) => <p key={limit}>{limit}</p>)}
        </details>)}
        <div className="br-meta"><span className="br-src">keyloom</span>{c === undefined ? <span>no longer applies to this version</span> : <span>source checked</span>}</div>
        <div className="br-actions">
          {c === undefined ? null : (
            <button type="button" className="sheet-action" disabled={r.stale} aria-pressed={pinnedId === c.changeSetId} onClick={() => onPin(c)}>{pinnedId === c.changeSetId ? "On the board" : "Show it on the board"}</button>
          )}
          <button type="button" className="sheet-action" disabled={r.busy || r.stale} onClick={() => void r.dismiss(item.id)}>Not this</button>
          {c === undefined ? null : (
            <button
              type="button"
              className="bar-apply"
              disabled={applying !== null || r.busy || !c.validation.ok || r.stale || review.ai.status === "running"}
              onClick={() => {
                setApplying(item.id);
                void onApply(c).finally(() => setApplying(null));
              }}
            >
              {applying === item.id ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}Apply
            </button>
          )}
        </div>
      </article>
    );
  };

  const finding = (item: ReviewItem) => (
    <Fragment key={item.id}>
      <article className="br-item" data-kind={item.kind} data-stale={stale}>
        <h4><i className="br-kind" data-kind={item.kind} aria-hidden="true" /><ReviewText text={item.title} layout={layout} rows={rows} /></h4>
        <p><ReviewText text={bodyOf(item, rows)} layout={layout} rows={rows} /></p>
        <div className="br-meta">
          {item.source === "check" ? <span className="br-src">Check</span> : <span className="br-src">keyloom</span>}
          {item.layers.length > 0 ? <span>marked on the strip</span> : item.keys.length > 0 ? <span>{item.keys.length === 1 ? "its key is marked on the board" : "its keys are marked on the board"}</span> : null}
        </div>
        <div className="br-actions">
          {item.layers[0] === undefined && item.keys[0] === undefined ? null : (
            <button type="button" className="sheet-action" disabled={r.stale} onClick={() => {
              const layerId = item.layers[0] ?? item.keys[0]?.layerId;
              if (layerId !== undefined) onShowLayer(layerId);
            }}>
              {item.layers[0] !== undefined ? "Show the layer" : "Show the keys"}
            </button>
          )}
          <button type="button" className="sheet-action" disabled={r.busy || r.stale} onClick={() => void r.dismiss(item.id)}>{item.kind === "problem" ? "It's on purpose · hide" : "Hide"}</button>
        </div>
      </article>
      {fixesFor(review, item.id).map(suggestion)}
    </Fragment>
  );

  const fixed = (item: FixedItem) => (
    <article key={`fixed:${item.id}`} className="br-item" data-kind="fixed">
      <h4><CircleCheck size={14} className="br-tick" aria-hidden="true" /> <ReviewText text={item.title} layout={layout} rows={rows} /></h4>
      <p>Fixed by your change.</p>
      <div className="br-meta"><span className="br-src">{item.source === "check" ? "Check" : "keyloom"}</span><span>just now</span></div>
    </article>
  );

  // A suggestion that fixes something shown sits under it; the rest are listed on their own.
  const shownIds = new Set([...g.problems, ...g.hints].map((i) => i.id));
  const loose = g.suggestions.filter((s) => !s.fixes.some((id) => shownIds.has(id)));

  const group = (title: string, count: number, body: ReactNode) => (
    <div className="br-group">
      <h3><b>{title}</b> {count}</h3>
      {body}
    </div>
  );

  return (
    <section className="br-panel" aria-label="Board review">
      {head}
      <div className="br-body">
        {r.stale ? <div className="br-actions"><button type="button" className="bar-apply" disabled={r.busy} onClick={() => void r.run(true)}>Run a fresh review</button></div> : null}
        {!r.stale && nothing && fixedNow.length === 0 ? (
          <p className="br-quiet br-nothing">
            <Check size={14} aria-hidden="true" /> No findings from these source checks of {review.checks.summary.layers} layers, {review.checks.summary.keys} keys and {review.checks.summary.combos} combos. This does not establish runtime behavior or better typing.
          </p>
        ) : null}
        {g.problems.length === 0 && fixedNow.length === 0 ? null : group("Problems", g.problems.length, <>{fixedNow.filter((f) => f.kind === "problem").map(fixed)}{g.problems.map(finding)}</>)}
        {loose.length === 0 ? null : group("Suggestions", loose.length, loose.map(suggestion))}
        {g.hints.length === 0 ? null : group("Hints", g.hints.length, <>{fixedNow.filter((f) => f.kind === "hint").map(fixed)}{g.hints.map(finding)}</>)}
        {workloadTests}

        {r.stale ? null : review.ai.status === "done" && review.ai.reason !== null ? (
          // A look that stopped early still shows what it found; say so, quietly, so a short list isn't read as all there is.
          <p className="br-quiet">{review.ai.reason}</p>
        ) : review.ai.status === "unavailable" || review.ai.status === "failed" ? (
          // Plain words and the one thing to do; the engine's reason is for whoever wants it, behind Details.
          <div className="br-ai-missing">
            <p className="br-ai-words">
              {review.ai.status === "unavailable" ? "Suggestions need a model, and none is set up." : "keyloom's own look didn't finish, so there are no suggestions this time."}
            </p>
            <div className="br-actions br-actions-start">
              {review.ai.status === "unavailable" ? (
                <button type="button" className="sheet-action" aria-expanded={picking} disabled={provider.status === null} onClick={() => setPicking((v) => !v)}>Set up a model</button>
              ) : (
                <button type="button" className="sheet-action" disabled={r.busy} onClick={() => void r.run(true)}>Try again</button>
              )}
              {review.ai.reason === null ? null : (
                <button type="button" className="sheet-action" aria-expanded={details} onClick={() => setDetails((v) => !v)}>{details ? "Hide details" : "Details"}</button>
              )}
            </div>
            {details && review.ai.reason !== null ? <p className="br-ai-reason">{review.ai.reason}</p> : null}
            {picking ? (
              <ProviderPicker
                token={token}
                status={provider.status}
                pinned={null}
                menuOpened={{ open: picking, onClose: () => setPicking(false) }}
                onChanged={(next) => {
                  provider.replace(next);
                  // The review's agent reads the same choice, so a model that is ready now can look at once.
                  if (next.active !== null && next.providers.find((p) => p.id === next.active?.provider)?.ready === true) void r.run(true);
                }}
              />
            ) : null}
          </div>
        ) : null}

        {showHidden && hidden.length > 0 ? (
          <div className="br-group">
            <h3><b>Hidden</b> {hidden.length}</h3>
            {hidden.map((item) => (
              <article key={item.id} className="br-item" data-kind="hidden">
                <h4><ReviewText text={item.title} layout={layout} rows={rows} /></h4>
                <div className="br-actions"><button type="button" className="sheet-action" disabled={r.busy || r.stale} onClick={() => void r.restore(item.id)}>Show it again</button></div>
              </article>
            ))}
          </div>
        ) : null}
        {r.problem === null ? null : <p className="br-problem" role="alert">{r.problem}</p>}
      </div>
      <footer className="br-foot">
        <span>
          {review.ai.status === "done" ? "" : "Checks only · "}
          {review.checks.summary.layers} layers, {review.checks.summary.keys} keys, {review.checks.summary.combos} combos checked
          {g.suggestions.length ? ` · ${g.suggestions.length} ${g.suggestions.length === 1 ? "suggestion" : "suggestions"}` : ""}
          {hidden.length === 0 ? "" : ` · ${hidden.length} hidden`}
        </span>
        <FixIssuesButton
          findings={fixableFindings(review.items).length}
          stale={r.stale}
          busy={r.busy}
          reviewing={review.ai.status === "pending" || review.ai.status === "running"}
          ready={activeProviderReady(provider.status)}
          onFix={onFixIssues}
        />
        {hidden.length === 0 ? null : <button type="button" className="sheet-action" disabled={r.stale} onClick={() => setShowHidden((v) => !v)}>{showHidden ? "Hide hidden" : "Show hidden"}</button>}
      </footer>
    </section>
  );
}

/** The marker by the config name (D-340): what the review found, calm; one click opens it. */
export function ReviewMarker({ review: r, open, onToggle }: { review: Review; open: boolean; onToggle: () => void }) {
  const review = r.review;
  if (!r.loaded || r.refreshing || review?.ai.status === "pending" || review?.ai.status === "running") return <button type="button" className="br-marker" aria-pressed={open} onClick={onToggle}>{r.problem === null ? <><LoaderCircle size={13} className="spin" aria-hidden="true" />Looking over…</> : <><FileText size={13} aria-hidden="true" />Review unavailable</>}</button>;
  if (review === null) {
    return <button type="button" className="br-marker" aria-pressed={open} onClick={onToggle}><i data-tone="hint" aria-hidden="true" />Not looked over yet</button>;
  }
  if (r.stale) return <button type="button" className="br-marker" aria-pressed={open} onClick={onToggle}><i data-tone="hint" aria-hidden="true" />Fresh review needed</button>;
  const g = grouped(review);
  const tone = g.problems.length > 0 ? "problem" : g.hints.length > 0 || g.suggestions.length > 0 ? "hint" : "ok";
  const text = markerWords(review) ?? "Looked over · nothing to note";
  return (
    <button type="button" className="br-marker" aria-pressed={open} aria-label={`Board review: ${text}`} onClick={onToggle}>
      <i data-tone={tone} aria-hidden="true" />{text}
    </button>
  );
}
