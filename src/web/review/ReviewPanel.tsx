import { Check, CircleCheck, FileText, Layers, LoaderCircle, Square, X } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import type { ChatProviderStatus, ProposalCard } from "../../api/http.ts";
import type { BoardReview } from "../../api/review.ts";
import type { Layout } from "../../layout/schema.ts";
import type { BoardDefinition, Geometry } from "../../boards/schema.ts";
import { keyName } from "../../boards/key-names.ts";
import { applyOps } from "../../layout/apply-ops.ts";
import { validate } from "../../validation/validate.ts";
import { proposalChanges } from "../../validation/proposal-changes.ts";
import type { ProposalChanges } from "../../validation/proposal-changes.ts";
import type { FixedItem, ReviewItem } from "../../validation/review-item.ts";
import { describeKey } from "../../layout/describe.ts";
import { layerName } from "../chat/proposal-facts.ts";
import { formatWhen } from "../history/words.ts";
import { MiniCap } from "../shell/Sheet.tsx";
import { ModelSetup } from "../chat/ModelSetup.tsx";
import { ProviderPicker } from "../chat/ProviderPicker.tsx";
import { activeProviderReady, offersPicker } from "../chat/provider-ready.ts";
import { useProviderStatus } from "../chat/useProviderStatus.ts";
import { CREDITS_PAGES, PROVIDER_NAMES } from "../chat/setup-words.ts";
import { chooseProvider } from "../chat/api-chat.ts";
import { APPLIED_NOT_SHOWN, type ApplyFailure, aiMissingWords, appliedNotShown, applyFailureWords, fixesFor, grouped, markerWords, placeOf, placeWords, segments, sentence } from "./review-words.ts";
import { type Review, asFailure } from "./useReview.ts";
import { SuggestionTestResults, WorkloadTests } from "./WorkloadTests.tsx";
import "./review.css";

export type Rows = Readonly<Record<string, readonly number[]>>;
type ProviderId = ChatProviderStatus["providers"][number]["id"];

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

export function reviewTextWords(text: string, layout: Layout, board: BoardDefinition, geometry: Geometry): string {
  return segments(text).map((part) => {
    if (part.kind === "text") return part.text;
    if (part.kind === "layer") return layerName(layout, part.layerId);
    return keyName(board, layout, { layerId: part.layerId, position: part.position }, { geometry, withLayer: true });
  }).join("");
}

function ProposalChangeDetails({ changes, before, board, ops }: { changes: ProposalChanges; before: Layout; board: BoardDefinition; ops: ProposalCard["ops"] }) {
  const applied = applyOps(before, ops);
  const after = applied.ok ? applied.layout : before;
  const profileRows = changes.profiles.flatMap((profile) => profile.fields.map((field) => ({ name: profile.name, label: field.label, field })));
  const displayed = profileRows.slice(0, 6);
  const extra = profileRows.slice(6);
  const keyName = (layerId: string, position: number) => {
    if (position >= board.keyCount) return `Unknown position ${position + 1}`;
    const physicalKey = board.physicalKeys?.[position];
    if (physicalKey !== undefined) return physicalKey;
    const index = before.layers.findIndex((layer) => layer.id === layerId);
    return index < 0 ? `Key ${position + 1}` : describeKey(before, index, position)?.legend.tap || `Key ${position + 1}`;
  };
  const keyGroups = (slots: readonly { layerId: string; position: number }[]) => {
    const groups = new Map<string, number[]>();
    for (const slot of slots) groups.set(slot.layerId, [...(groups.get(slot.layerId) ?? []), slot.position]);
    return [...groups].map(([layerId, positions]) => {
      const source = before.layers.some((layer) => layer.id === layerId) ? before : after;
      return { layerId, name: layerName(source, layerId), positions: [...new Set(positions)].sort((a, b) => a - b) };
    });
  };
  const bindingLegends = (layerId: string, position: number) => {
    const oldIndex = before.layers.findIndex((layer) => layer.id === layerId);
    const nextIndex = after.layers.findIndex((layer) => layer.id === layerId);
    return {
      current: oldIndex < 0 ? "Absent" : describeKey(before, oldIndex, position)?.legend.tap || keyName(layerId, position),
      proposed: nextIndex < 0 ? "Absent" : describeKey(after, nextIndex, position)?.legend.tap || keyName(layerId, position),
    };
  };
  const bindingBySlot = new Map(changes.bindings.map((binding) => [`${binding.slot.layerId}:${binding.slot.position}`, binding]));
  const callerGroups = changes.callers;
  const currentCallerCount = callerGroups.filter((group) => group.phase === "current").reduce((total, group) => total + group.slots.length, 0);
  const proposedCallerCount = callerGroups.filter((group) => group.phase === "proposed").reduce((total, group) => total + group.slots.length, 0);
  const comparisonRows = (entries: readonly { name: string; label: string; field: ProposalChanges["profiles"][number]["fields"][number] }[]) => entries.map(({ name, label, field }) => <Fragment key={`${name}:${field.key}`}>
    <tr><th scope="row">{name}{label ? ` · ${label}` : ""}{field.recognized ? null : <small>Unknown option</small>}{field.verified === false ? <small>Effect not established</small> : null}</th>
      <td>{field.currentValues ? `${field.currentValues.length} ${field.key === "hold-trigger-key-positions" ? "positions" : "numeric values"}` : field.current}</td>
      <td>{field.proposedValues ? `${field.proposedValues.length} ${field.key === "hold-trigger-key-positions" ? "positions" : "numeric values"}` : field.proposed}</td></tr>
    {field.currentValues || field.proposedValues ? <tr key={`${name}:${field.key}:values`}><td colSpan={3}><details className="br-value-details"><summary>All values</summary>
      <p>Current values: {field.currentValues?.map((value) => field.key === "hold-trigger-key-positions" ? value + 1 : value).join(", ") ?? "none"}</p>
      <p>Proposed values: {field.proposedValues?.map((value) => field.key === "hold-trigger-key-positions" ? value + 1 : value).join(", ") ?? "none"}</p>
    </details></td></tr> : null}
  </Fragment>);
  return (
    <section className="br-proposal-changes" aria-label="Current and proposed changes">
      {changes.incomplete.length === 0 ? null : <div className="br-unverified" role="note"><strong>Comparison incomplete. Preview and Apply are unavailable.</strong><ul>{changes.incomplete.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
      {profileRows.length === 0 ? null : <>
        <h5>Tap/hold settings</h5>
        <table className="br-change-table"><thead><tr><th scope="col">Setting</th><th scope="col">Current</th><th scope="col">Proposed</th></tr></thead><tbody>{comparisonRows(displayed)}</tbody></table>
        {extra.length === 0 ? null : <details><summary>More changed settings ({extra.length})</summary><table className="br-change-table"><tbody>{comparisonRows(extra)}</tbody></table></details>}
      </>}
      {changes.sections.map((section) => <section className="br-comparison-section" key={section.title}>
        <h5>{section.title}</h5>
        <table className="br-change-table"><thead><tr><th scope="col">Change</th><th scope="col">Current</th><th scope="col">Proposed</th></tr></thead>
          <tbody>{comparisonRows(section.items.flatMap((item) => item.fields.map((field) => ({ name: item.name, label: field.label, field }))))}</tbody>
        </table>
      </section>)}
      {callerGroups.length === 0 ? null : <details className="br-scope-details"><summary>Profile caller keys ({currentCallerCount} current · {proposedCallerCount} proposed)</summary>
        {callerGroups.map((group) => <div className="br-scope-group" key={`${group.profileName}:${group.phase}:${group.layerId}`}><span className="br-layer">{group.profileName} · {group.layerName} · {group.phase}</span>
          {group.slots.slice(0, 6).map((slot) => <MiniCap key={slot.position}>{keyName(group.layerId, slot.position)}</MiniCap>)}
          {group.slots.length > 6 ? <details><summary>More keys ({group.slots.length - 6})</summary>{group.slots.slice(6).map((slot) => <MiniCap key={slot.position}>{keyName(group.layerId, slot.position)}</MiniCap>)}</details> : null}
        </div>)}
      </details>}
      {changes.changedSlots.length === 0 ? null : <details className="br-scope-details"><summary>Keys whose bindings change ({changes.changedSlots.length})</summary>
        {keyGroups(changes.changedSlots).map((group) => <div className="br-scope-group" key={group.layerId}><span className="br-layer">{group.name}</span>{group.positions.slice(0, 6).map((position) => {
          const binding = bindingLegends(group.layerId, position);
          const effect = bindingBySlot.get(`${group.layerId}:${position}`);
          return <span className="br-binding-change" key={position}><span className="br-binding-side"><MiniCap>{binding.current}</MiniCap><span>{effect?.current ?? "Effect unavailable"}</span></span><span aria-hidden="true">→</span><span className="br-binding-side"><MiniCap>{binding.proposed}</MiniCap><span>{effect?.proposed ?? "Effect unavailable"}</span></span></span>;
        })}
          {group.positions.length > 6 ? <details><summary>More changed keys ({group.positions.length - 6})</summary>{group.positions.slice(6).map((position) => {
            const binding = bindingLegends(group.layerId, position);
            const effect = bindingBySlot.get(`${group.layerId}:${position}`);
            return <span className="br-binding-change" key={position}><span>{keyName(group.layerId, position)}</span><span className="br-binding-side"><MiniCap>{binding.current}</MiniCap><span>{effect?.current ?? "Effect unavailable"}</span></span><span aria-hidden="true">→</span><span className="br-binding-side"><MiniCap>{binding.proposed}</MiniCap><span>{effect?.proposed ?? "Effect unavailable"}</span></span></span>;
          })}</details> : null}
        </div>)}
      </details>}
      {changes.triggers.length === 0 ? null : <details className="br-scope-details"><summary>Hold-trigger positions changed</summary>
        {changes.triggers.map((set) => <div key={set.profileName}><strong>{set.profileName}</strong>
          <p>Added positions: {set.added.length ? set.added.map((position) => `${position + 1} (${keyName(before.layers[0]?.id ?? "", position)})`).join(", ") : "none"}</p>
          <p>Removed positions: {set.removed.length ? set.removed.map((position) => `${position + 1} (${keyName(before.layers[0]?.id ?? "", position)})`).join(", ") : "none"}</p>
          {set.added.length + set.removed.length > 12 ? <p>Positions are one-based. Keyboard labels are from the current base layer; positions identify physical slots.</p> : null}
        </div>)}
      </details>}
    </section>
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
export function ReviewPanel({ token, review: r, layout, board, rows, boardName, configName, proposals, pinnedId, onPin, onApply, onShowLayer, onPlanRepair, onClose, proposalsFailed = false, onReadProposals }: {
  token: string;
  review: Review;
  layout: Layout;
  board: BoardDefinition;
  /** The board's rows, to say where a key with no legend is. */
  rows: Rows;
  boardName: string;
  configName: string;
  /** The config's open proposals, for a suggestion's card. */
  proposals: readonly ProposalCard[] | null;
  pinnedId: string | null;
  onPin: (card: ProposalCard) => void;
  /** Rejects when the Apply failed or its outcome is unknown; resolves with `showAgain` when it landed but the new layout couldn't be read. */
  onApply: (card: ProposalCard) => Promise<void | { showAgain: () => Promise<void> }>;
  onShowLayer: (layerId: string) => void;
  onPlanRepair: (item: ReviewItem) => void;
  onClose: () => void;
  /** The config's proposals could not be read, so suggestions have no change to show or apply until they are read again (R4-08). */
  proposalsFailed?: boolean;
  /** Reads the proposals again: after a failed read, and after an Apply whose outcome is unknown. */
  onReadProposals?: () => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const [details, setDetails] = useState(false);
  const [picking, setPicking] = useState(false);
  const provider = useProviderStatus(token);
  // A model is set up but isn't the chosen one: Set up a model offers the picker, to choose the ready one; otherwise the setup.
  // A locked choice (--provider, KEYLOOM_PROVIDER) can't be changed in the picker, so it gets the setup.
  const pickReady = offersPicker(provider.status);
  const [applying, setApplying] = useState<string | null>(null);
  const [applyFailure, setApplyFailure] = useState<{ itemId: string; view: ApplyFailure; showAgain?: () => Promise<void> } | null>(null);
  const apply = (itemId: string, card: ProposalCard) => {
    setApplying(itemId);
    setApplyFailure(null);
    void onApply(card).then((outcome) => {
      if (outcome !== undefined) setApplyFailure({ itemId, view: APPLIED_NOT_SHOWN, showAgain: outcome.showAgain });
    }, (error: unknown) => {
      setApplyFailure({ itemId, view: applyFailureWords(asFailure(error)) });
    }).finally(() => setApplying(null));
  };
  const review = r.review;
  const missing = review === null ? null : aiMissingWords(review.ai, provider.status?.lockedBy == null);
  // After a usage limit (R6-01): the ready providers the review can move to, and the setup for the rest. The review's agent reads the
  // same choice as chat, so switching here is what the next look runs on.
  const activeId = provider.status?.active?.provider;
  const switchTo = provider.status === null || provider.status.lockedBy !== null ? [] : provider.status.providers.filter((p) => p.ready && p.id !== activeId).map((p) => p.id);
  const others = (provider.status?.providers ?? []).map((p) => p.id).filter((id) => id !== activeId);
  const [settingUpOther, setSettingUpOther] = useState(false);
  const [switching, setSwitching] = useState<ProviderId | null>(null);
  const [switchFailed, setSwitchFailed] = useState<{ id: ProviderId; words: string } | null>(null);
  const switchProvider = (id: ProviderId) => {
    setSwitching(id);
    setSwitchFailed(null);
    void chooseProvider(token, { provider: id }).then((next) => {
      provider.replace(next);
      setSettingUpOther(false);
      void r.run(true);
    }, (error: unknown) => setSwitchFailed({ id, words: `keyloom couldn't switch to ${PROVIDER_NAMES[id]}.${error instanceof Error && error.message.trim() !== "" ? ` ${sentence(error.message)}` : ""}` }))
      .finally(() => setSwitching(null));
  };
  // The billing page of the provider the review runs on; Codex sells no credits, so it has none.
  const activeProvider = provider.status?.active?.provider;
  const creditsUrl = activeProvider === "anthropic" || activeProvider === "openrouter" ? CREDITS_PAGES[activeProvider] : undefined;
  const loading = !r.loaded || r.refreshing || review?.ai.status === "pending" || review?.ai.status === "running";
  const readFailed = loading && r.readFailed;
  const now = Date.now();
  const card = (item: ReviewItem) => (item.proposalId === null ? undefined : proposals?.find((p) => p.changeSetId === item.proposalId && p.status === "proposed"));
  const workloadTests = <WorkloadTests key={JSON.stringify(r.activities)} token={token} firmware={board.firmware} activities={r.activities} evidence={review?.workload} busy={r.busy || review?.ai.status === "running"} onRun={(activities) => void r.run(true, activities)} />;

  // A failed request says what failed with the one button that moves on: the same request again, or a fresh read (R5-03, R5-10).
  const problem = r.problem === null ? null : (
    <div className="br-apply-failure" role="alert">
      <p>{r.problem}</p>
      {r.problemAction === null ? null : <button type="button" className="sheet-action" onClick={r.problemAction.run}>{r.problemAction.label}</button>}
    </div>
  );
  // Every running look has a Stop (R6-12). While its activity tests run it ends them, the look they belong to and their container (R5-17);
  // otherwise it ends the look, so the label says which.
  const running = review?.ai.status === "running";
  const testing = running && (review.workload?.status === "pending" || review.workload?.status === "running");

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
        {running && !readFailed ? (
          <div className="br-actions br-actions-start">
            <button type="button" className="sheet-action" disabled={r.stopping} onClick={() => void r.stop()}>{r.stopping ? <LoaderCircle size={12} className="spin" aria-hidden="true" /> : <Square size={12} aria-hidden="true" />}{r.stopping ? "Stopping" : testing ? "Stop testing" : "Stop the review"}</button>
          </div>
        ) : null}
        {problem}
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
          {problem}
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
    const changes = c === undefined ? undefined : (() => {
      try {
        return validate(board, layout, c.ops).ok ? proposalChanges(layout, c.ops, board) : undefined;
      } catch { return undefined; }
    })();
    const sourceChecked = changes !== undefined && changes.incomplete.length === 0;
    return (
      <article key={item.id} className="br-item" data-kind="suggestion" data-pinned={(c !== undefined && pinnedId === c.changeSetId) || undefined} data-stale={stale}>
        <h4><i className="br-kind" data-kind="suggestion" aria-hidden="true" /><ReviewText text={item.title} layout={layout} rows={rows} /></h4>
        {changes === undefined && proposals === null ? <p>Reading this suggestion&apos;s change…</p>
          : changes === undefined && proposalsFailed ? <p>keyloom couldn&apos;t read this suggestion&apos;s change, so it can&apos;t be shown or applied yet.</p>
          : changes === undefined ? <p>The proposal is unavailable or no longer valid for this config, so its changes cannot be verified.</p>
          : sourceChecked ? <p>These source changes can be previewed on the board. Source values do not establish runtime behavior or typing outcomes.</p>
            : <p>The proposal is valid, but some changed values cannot be fully compared. The unverified details are marked below; preview and Apply are unavailable.</p>}
        {changes && c ? <ProposalChangeDetails changes={changes} before={layout} board={board} ops={c.ops} /> : null}
        <SuggestionTestResults baseline={review.workload?.baseline ?? []} result={review.workload?.comparisons.find((c) => c.proposalId === item.proposalId)} />
        {review.behavior?.filter((b) => b.proposalId === item.proposalId).map((b) => <details key={b.proposalId}>
          <summary>Affected behavior · {b.status === "not-tested" ? "not tested" : b.status}</summary>
          {b.checks.map((check) => <p key={check.name}><ReviewText text={check.name} layout={layout} rows={rows} />: {check.status}{check.reason ? ` — ${check.reason}` : ""}</p>)}
          {b.limitations.map((limit) => <p key={limit}>{limit}</p>)}
        </details>)}
        <div className="br-meta"><span className="br-src">keyloom</span>{sourceChecked ? <span>source checked</span> : changes === undefined ? <span>{proposalsFailed ? "change not read" : "change unavailable or invalid for this version"}</span> : <span>comparison incomplete</span>}</div>
        <div className="br-actions">
          {c === undefined ? null : (
            <button type="button" className="sheet-action" disabled={r.stale || !sourceChecked} aria-pressed={pinnedId === c.changeSetId} onClick={() => onPin(c)}>{pinnedId === c.changeSetId ? "On the board" : "Show it on the board"}</button>
          )}
          <button type="button" className="sheet-action" disabled={r.busy || r.stale} onClick={() => void r.dismiss(item.id)}>Not this</button>
          {c === undefined ? null : (
            <button
              type="button"
              className="bar-apply"
              disabled={applying !== null || r.busy || !sourceChecked || r.stale || review.ai.status === "running" || (applyFailure?.itemId === item.id && applyFailure.view.action === "check")}
              onClick={() => apply(item.id, c)}
            >
              {applying === item.id ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}Apply
            </button>
          )}
        </div>
        {/* Kept when the suggestion has left the list: an Apply that landed still has something to say. */}
        {applyFailure?.itemId !== item.id ? null : (
          <div className="br-apply-failure" role="alert">
            <p>{applyFailure.view.words}</p>
            {applyFailure.view.action === "fresh_review" ? (
              <button type="button" className="sheet-action" disabled={r.busy} onClick={() => { setApplyFailure(null); void r.run(true); }}>Run a fresh review</button>
            ) : applyFailure.view.action === "show" ? (
              <button type="button" className="sheet-action" onClick={() => {
                const failure = applyFailure;
                const showAgain = failure.showAgain;
                // A second failure says so and keeps the button: the change is in the config either way (R5-09).
                if (showAgain !== undefined) void showAgain().then(() => setApplyFailure(null), (error: unknown) => setApplyFailure({ ...failure, view: appliedNotShown(error) }));
              }}>Show the new layout</button>
            ) : applyFailure.view.action === "check" ? (
              // An Apply that landed takes the suggestion off the list, so reading it again is what tells.
              <button type="button" className="sheet-action" onClick={() => { setApplyFailure(null); onReadProposals?.(); }}>Check again</button>
            ) : (
              c === undefined ? null : <button type="button" className="sheet-action" disabled={applying !== null || r.busy} onClick={() => apply(item.id, c)}>Try again</button>
            )}
          </div>
        )}
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
          <button type="button" className="sheet-action" disabled={r.busy || r.stale || loading} onClick={() => onPlanRepair(item)}>Plan a repair</button>
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
        {proposalsFailed && onReadProposals !== undefined ? (
          // The suggestions' changes live in the config's proposals; an unread list is not a missing one (R4-08).
          <div className="br-apply-failure" role="alert">
            <p>keyloom couldn&apos;t read this config&apos;s proposals, so suggestions can&apos;t be applied yet.</p>
            <button type="button" className="sheet-action" onClick={onReadProposals}>Try again</button>
          </div>
        ) : null}
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
        ) : (review.ai.status === "unavailable" || review.ai.status === "failed") && missing !== null ? (
          // Plain words and the one thing to do; the engine's reason is for whoever wants it, behind Details.
          <div className="br-ai-missing">
            <p className="br-ai-words">{missing.words}</p>
            <div className="br-actions br-actions-start">
              {missing.actions.includes("credits") && creditsUrl !== undefined ? (
                <a className="sheet-action" href={creditsUrl} target="_blank" rel="noreferrer">Add credits</a>
              ) : null}
              {missing.actions.includes("switch") ? switchTo.map((id) => (
                <button key={id} type="button" className="sheet-action" disabled={switching !== null || r.busy} onClick={() => switchProvider(id)}>
                  {switching === id ? <LoaderCircle size={12} className="spin" aria-hidden="true" /> : null}Switch to {PROVIDER_NAMES[id]}
                </button>
              )) : null}
              {missing.actions.includes("set_up_other") && switchTo.length === 0 ? (
                <button type="button" className="sheet-action" aria-expanded={settingUpOther} onClick={() => { if (provider.status === null) provider.reload(); setSettingUpOther((v) => !v); }}>Set up another model</button>
              ) : null}
              {missing.actions.includes("set_up") ? (
                <button type="button" className="sheet-action" aria-expanded={picking} onClick={() => { if (provider.status === null) provider.reload(); setPicking((v) => !v); }}>Set up a model</button>
              ) : null}
              {missing.actions.includes("retry") ? (
                // Not while a switch is on its way: a run started now would hold the old model, and the switch's run would join it.
                <button type="button" className="sheet-action" disabled={r.busy || switching !== null} onClick={() => void r.run(true)}>Try again</button>
              ) : null}
              {review.ai.reason === null || missing.reasonShown ? null : (
                <button type="button" className="sheet-action" aria-expanded={details} onClick={() => setDetails((v) => !v)}>{details ? "Hide details" : "Details"}</button>
              )}
            </div>
            {details && review.ai.reason !== null && !missing.reasonShown ? <p className="br-ai-reason">{review.ai.reason}</p> : null}
            {switchFailed === null ? null : (
              <div className="br-apply-failure" role="alert">
                <p>{switchFailed.words}</p>
                <button type="button" className="sheet-action" disabled={switching !== null} onClick={() => switchProvider(switchFailed.id)}>Try again</button>
              </div>
            )}
            {settingUpOther && switchTo.length === 0 ? (
              // Another provider, set up here; once it is ready, Switch to it appears above.
              <ModelSetup token={token} status={provider.status} only={others} onReload={() => void provider.reload()} onChanged={(next) => {
                provider.replace(next);
                // A provider set up here can become the chosen one by itself (no choice saved yet); then the review runs on it at once.
                if (next.active?.provider !== activeId && activeProviderReady(next)) {
                  setSettingUpOther(false);
                  void r.run(true);
                }
              }} />
            ) : null}
            {picking && (!pickReady || missing.refused) ? (
              // Nothing is set up, or the provider refused the account: the same setup the chat uses (D-496), with the refused provider's
              // key field open. A key saved here is used by the review at once.
              <ModelSetup
                token={token}
                status={provider.status}
                replacing={missing.refused ? provider.status?.active?.provider ?? null : null}
                onReload={() => void provider.reload()}
                onChanged={(next) => {
                  provider.replace(next);
                  if (activeProviderReady(next)) {
                    setPicking(false);
                    void r.run(true);
                  }
                }}
              />
            ) : picking ? (
              // A model is set up but isn't the one chosen: pick the ready one.
              <ProviderPicker
                token={token}
                status={provider.status}
                pinned={null}
                onReload={() => void provider.reload()}
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
        {problem}
      </div>
      <footer className="br-foot">
        <span>
          {review.ai.status === "done" ? "" : "Checks only · "}
          {review.checks.summary.layers} layers, {review.checks.summary.keys} keys, {review.checks.summary.combos} combos checked
          {g.suggestions.length ? ` · ${g.suggestions.length} ${g.suggestions.length === 1 ? "suggestion" : "suggestions"}` : ""}
          {hidden.length === 0 ? "" : ` · ${hidden.length} hidden`}
        </span>
        {hidden.length === 0 ? null : <button type="button" className="sheet-action" disabled={r.stale} onClick={() => setShowHidden((v) => !v)}>{showHidden ? "Hide hidden" : "Show hidden"}</button>}
      </footer>
    </section>
  );
}

/** The marker by the config name (D-340): what the review found, calm; one click opens it. */
export function ReviewMarker({ review: r, open, onToggle }: { review: Review; open: boolean; onToggle: () => void }) {
  const review = r.review;
  if (!r.loaded || r.refreshing || review?.ai.status === "pending" || review?.ai.status === "running") return <button type="button" className="br-marker" aria-pressed={open} onClick={onToggle}>{!r.readFailed ? <><LoaderCircle size={13} className="spin" aria-hidden="true" />Looking over…</> : <><FileText size={13} aria-hidden="true" />Review unavailable</>}</button>;
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
