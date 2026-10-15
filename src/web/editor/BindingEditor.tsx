import {
  ArrowRight, Ban, Cpu, Keyboard, Layers, LoaderCircle, Play, SquareDashed, Timer, TriangleAlert, X, ChevronUp,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { describeKey } from "../../layout/describe.ts";
import { bindingLegend } from "../../layout/legend.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { applyChange } from "../api-write.ts";
import { Cap } from "../keyboard/Cap.tsx";
import { ChoiceGroup, type Choice } from "./ChoiceGroup.tsx";
import {
  bindingFromDraft, changeSummary, draftFromBinding, incompleteReason, sameBinding, switchKind, withBinding, type Draft,
} from "./draft.ts";
import { HoldTapForm, KeyForm, LayerForm, MacroForm, ModifierForm, PlainForm, type FormProps } from "./KindForms.tsx";
import { functionName } from "./function-label.ts";
import { LostFunctions, type LostRow } from "./LostFunctions.tsx";
import { type LostFunction, type Placement, canDrop, dropReason, editorOps, keyName, lostFunctionsIn, placeableBinding, splitLost } from "./lost-functions.ts";
import { useOpsCheck } from "./useCheck.ts";
import { Validation } from "./Validation.tsx";
import "./editor.css";

/** A kept function waiting for a key to be clicked: what to put there, copied from where it was. */
export interface PlaceRequest {
  function: string;
  binding: Binding;
}

export interface DraftState {
  /** The draft as a binding when it is complete and differs from what is applied. */
  binding: Binding | null;
  /** True once anything has been touched, even if the draft is not complete. */
  dirty: boolean;
}

interface Props {
  token: string;
  layoutRef: string;
  layout: Layout;
  revisionId: string;
  layerId: string;
  position: number;
  finger: string | undefined;
  /** Focus the first control; true when the person just opened the editor, false when it followed the selection. */
  autoFocus: boolean;
  /** The person tried to select another key while this draft had unsaved changes. */
  blocked: boolean;
  onDraft: (state: DraftState) => void;
  /** Keys the person chose to keep a lost function on, and the function waiting for a click on the board. */
  placements: readonly Placement[];
  placing: PlaceRequest | null;
  /** Starts place mode for a function, or ends it (null). */
  onPlace: (request: PlaceRequest | null) => void;
  onUnplace: (fn: string) => void;
  onClose: () => void;
  /** Resolves once the new layout is on screen. `change` is what the key was and became, for "repeat on selection". */
  onApplied: (summary: string, change: { before: Binding; after: Binding }) => Promise<void>;
  /** The layout moved on under this editor; the parent reloads and closes it. */
  onStale: () => void;
}

const KINDS: readonly Choice<Binding["kind"]>[] = [
  { value: "key", label: "Key", icon: <Keyboard size={16} /> },
  { value: "modifier", label: "Modifier", icon: <ChevronUp size={16} /> },
  { value: "holdTap", label: "Hold-tap", icon: <Timer size={16} /> },
  { value: "layer", label: "Layer", icon: <Layers size={16} /> },
  { value: "macro", label: "Macro", icon: <Play size={16} /> },
  { value: "transparent", label: "Transparent", icon: <SquareDashed size={16} /> },
  { value: "none", label: "None", icon: <Ban size={16} /> },
];
const NATIVE_KIND: Choice<Binding["kind"]> = { value: "native", label: "Native", icon: <Cpu size={16} /> };
const TAP_DANCE_KIND: Choice<Binding["kind"]> = { value: "tapDance", label: "Tap dance", icon: <Timer size={16} /> };

const FORMS: Record<Binding["kind"], (props: FormProps) => ReactNode> = {
  key: KeyForm,
  modifier: ModifierForm,
  holdTap: HoldTapForm,
  layer: LayerForm,
  macro: MacroForm,
  transparent: PlainForm,
  none: PlainForm,
  native: PlainForm,
  tapDance: PlainForm,
};
// Kinds whose form has a control to land on; the others leave focus on the kind list.
const FOCUSES_FORM: ReadonlySet<Binding["kind"]> = new Set(["key", "holdTap", "layer", "macro"]);

// The history entry says what was kept and dropped as well as what the key became, so the undo button names all of it.
function withChoices(summary: string, layout: Layout, placements: readonly Placement[], drops: ReadonlySet<string>): string {
  const kept = placements.map((p) => `${functionName(p.function, layout)} moved to ${keyName(layout, p.slot)}`);
  const dropped = [...drops].map((fn) => `${functionName(fn, layout)} dropped`);
  const full = [summary, ...kept, ...dropped].join("; ");
  return full.length <= 200 ? full : `${full.slice(0, 199)}…`;
}

export function BindingEditor({
  token, layoutRef, layout, revisionId, layerId, position, finger, autoFocus, blocked, onDraft, placements, placing, onPlace, onUnplace,
  onClose, onApplied, onStale,
}: Props) {
  const layerIndex = layout.layers.findIndex((layer) => layer.id === layerId);
  const layer = layout.layers[layerIndex];
  const original = layer?.bindings[position];
  const initial = useMemo(
    () => (original === undefined ? null : draftFromBinding(original, layout, layerId)),
    // The editor is keyed by key and revision, so the layout it opened on is the one it edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [draft, setDraft] = useState<Draft | null>(initial);
  const [wantFocus, setWantFocus] = useState(autoFocus);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // Optional: typed here, it becomes a decision a later change to this key brings back (08).
  const [reason, setReason] = useState("");
  const reasonId = useId();
  // Replacing a native binding drops behaviour keyloom cannot rebuild, so it takes a second click.
  const [confirmingNative, setConfirmingNative] = useState(false);
  useEffect(() => setWantFocus(false), []);

  const draftBinding = draft === null ? null : bindingFromDraft(draft, layout);
  const changed = draftBinding !== null && original !== undefined && !sameBinding(draftBinding, original);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(initial);
  const binding = changed ? draftBinding : null;
  const slot = useMemo(() => ({ layerId, position }), [layerId, position]);
  // Functions the person chose to let go of; each becomes a dropFunction op with a generated reason.
  const [drops, setDrops] = useState<ReadonlySet<string>>(new Set());
  const replacedBy = useMemo(
    () => (binding === null || layerIndex < 0 ? "" : (describeKey(withBinding(layout, layerId, position, binding), layerIndex, position)?.headline ?? "")),
    [binding, layout, layerId, layerIndex, position],
  );
  const ops = useMemo(
    () => (binding === null ? null : editorOps(slot, binding, placements, new Map([...drops].map((fn) => [fn, dropReason(replacedBy, layout, slot)])))),
    [binding, slot, placements, drops, replacedBy, layout],
  );
  const check = useOpsCheck({ token, layoutRef, revisionId, ops });
  // The last answer's lost functions stay on screen while the next check runs, so the buttons don't flicker away.
  const [lostNow, setLostNow] = useState<LostRow[]>([]);
  const [strandedNow, setStrandedNow] = useState<LostFunction[]>([]);
  useEffect(() => {
    if (check.state.status === "idle") {
      setLostNow([]);
      setStrandedNow([]);
      setDrops((previous) => (previous.size === 0 ? previous : new Set()));
    }
    if (check.state.status !== "done") return;
    const { result } = check.state;
    const { direct, collateral } = splitLost(lostFunctionsIn(result), [slot, ...placements.map((placement) => placement.slot)]);
    setLostNow(direct.map((lost) => ({ lost, droppable: canDrop(lost, layout, result) })));
    setStrandedNow(collateral);
  }, [check.state, slot, placements, layout]);

  const bindingKey = binding === null ? "" : JSON.stringify(binding);
  useEffect(() => {
    onDraft({ binding, dirty });
    // The key string stands for the binding, so a new object with the same content doesn't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingKey, dirty]);

  const preview = useMemo(() => {
    if (binding === null || layerIndex < 0) return null;
    return describeKey(withBinding(layout, layerId, position, binding), layerIndex, position);
  }, [binding, layout, layerId, layerIndex, position]);
  const current = useMemo(() => describeKey(layout, layerIndex, position), [layout, layerIndex, position]);

  if (draft === null || layer === undefined || original === undefined) return null;

  const update = (patch: Partial<Draft>) => {
    setApplyError(null);
    setConfirmingNative(false);
    setDraft((previous) => (previous === null ? previous : { ...previous, ...patch }));
  };
  const idleNote =
    draft !== null && incompleteReason(draft, layout) !== null
      ? (incompleteReason(draft, layout) as string)
      : "Pick a new binding and keyloom checks it here before anything is saved.";

  const summary = binding === null ? null : withChoices(changeSummary(layout, layerId, position, binding), layout, placements, drops);
  const result = check.state.status === "done" ? check.state.result : null;
  const canApply = binding !== null && result !== null && result.ok && !applying;
  const warnings = result?.warnings.length ?? 0;
  const replacesNative = original.kind === "native" && binding !== null && binding.kind !== "native";

  async function apply() {
    if (!canApply || binding === null || summary === null || original === undefined || ops === null) return;
    if (replacesNative && !confirmingNative) {
      setConfirmingNative(true);
      return;
    }
    setApplying(true);
    setApplyError(null);
    try {
      await applyChange(token, layoutRef, {
        baseRevisionId: revisionId,
        ops: ops ?? [],
        summary,
        ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
      });
      await onApplied(summary, { before: original, after: binding });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code?.startsWith("stale")) {
        onStale();
      } else if (error instanceof ApiError) {
        if (error.validation !== undefined) check.show(error.validation);
        // The server's message quotes the validator's own text; the problems are listed in words above.
        setApplyError(error.validation === undefined ? error.message : "This change has problems, listed above. Nothing was saved.");
      } else {
        setApplyError("The change could not be applied.");
      }
    } finally {
      setApplying(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void apply();
    }
  }

  const ctx = { layers: layout.layers, macros: layout.macros };
  const shownLegend = binding !== null ? bindingLegend(binding, ctx) : draftBinding !== null ? bindingLegend(draftBinding, ctx) : { kind: "none" as const, tap: "?" };
  const Form = FORMS[draft.kind];
  const kindChoices = [...(draft.tapDance === null ? [] : [TAP_DANCE_KIND]), ...(draft.native === null ? [] : [NATIVE_KIND]), ...KINDS];
  const formFocus = wantFocus && FOCUSES_FORM.has(draft.kind);
  const where = [layer.name, finger === undefined ? undefined : `${finger.replace("-", " ")} finger`].filter(Boolean).join(" · ");
  const applyLabel = applying ? "Applying" : confirmingNative ? "Replace and apply" : warnings > 0 ? `Apply with ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : "Apply change";
  const whyNot = binding === null ? (dirty ? idleNote : "Change the binding first.") : check.state.status === "checking" ? "Checking the change." : result !== null && !result.ok ? "Fix the errors above first." : null;

  return (
    <section className="card editor" aria-label={`Edit key ${position + 1}`} onKeyDown={onKeyDown}>
      <header className="editor-head">
        <div className="inspector-cap" data-pending={binding !== null}>
          <Cap as="span" tone={shownLegend.kind} legend={shownLegend} unit={64} width={1} style={{ width: 64, height: 64 }} />
        </div>
        <div className="editor-title">
          <h2>Edit key {position + 1}</h2>
          <p className="muted">{where}</p>
        </div>
        <dl className="editor-change" aria-live="polite">
          <div>
            <dt>Now</dt>
            <dd>{current?.headline ?? ""}</dd>
          </div>
          <ArrowRight size={16} aria-hidden="true" className="editor-arrow" />
          <div data-pending={binding !== null}>
            <dt>After this change</dt>
            <dd>{preview?.headline ?? "No change yet"}</dd>
          </div>
        </dl>
        <button type="button" className="icon-button editor-close" aria-label="Close the editor" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <fieldset className="editor-body" disabled={applying}>
        <ChoiceGroup
          legend="Kind of binding"
          variant="list"
          choices={kindChoices}
          value={draft.kind}
          autoFocus={wantFocus && !FOCUSES_FORM.has(draft.kind)}
          onChange={(kind) => {
            setApplyError(null);
            setConfirmingNative(false);
            setDraft((previous) => (previous === null ? previous : switchKind(previous, kind)));
          }}
        />
        <div className="editor-form">
          <Form draft={draft} layout={layout} layerId={layerId} autoFocus={formFocus} update={update} />
          {binding === null ? null : (
            <LostFunctions
              layout={layout}
              rows={lostNow}
              strandedCount={strandedNow.length}
              strandedLayers={[...new Set(strandedNow.flatMap((lost) => lost.was.map((was) => layout.layers.find((l) => l.id === was.layerId)?.name ?? "another layer")))]}
              drops={drops}
              placements={placements}
              placing={placing?.function ?? null}
              onDrop={(fns) => setDrops((previous) => new Set([...previous, ...fns]))}
              onKeep={(fn) => setDrops((previous) => new Set([...previous].filter((candidate) => candidate !== fn)))}
              onPlace={(lost) => {
                const placeable = placeableBinding(layout, lost);
                if (placeable !== null) onPlace({ function: lost.function, binding: placeable });
              }}
              onCancelPlace={() => onPlace(null)}
              onUnplace={onUnplace}
            />
          )}
          <Validation layout={layout} slot={slot} idleNote={idleNote} state={check.state} onRecheck={check.recheck} hideLost />
          {binding === null ? null : (
            <div className="editor-reason">
              <label htmlFor={reasonId}>Why this change? <span className="muted">Optional</span></label>
              <input
                id={reasonId}
                value={reason}
                maxLength={300}
                placeholder="So you remember it later"
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="muted">keyloom keeps your reason and brings it up if you change this key again.</p>
            </div>
          )}
        </div>
      </fieldset>

      <footer className="editor-foot">
        <div className="editor-foot-note" aria-live="polite">
          {confirmingNative ? (
            <p className="blocked" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              keyloom can&apos;t edit this key&apos;s custom behaviour. Replacing it removes that behaviour.
            </p>
          ) : blocked ? (
            <p className="blocked">
              <TriangleAlert size={16} aria-hidden="true" />
              Apply or cancel this change before editing another key.
            </p>
          ) : applyError !== null ? (
            <p className="blocked" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              {applyError}
            </p>
          ) : (
            <p className="muted">{summary ?? "Nothing is saved until you apply."}</p>
          )}
        </div>
        <button type="button" className="button" onClick={onClose} disabled={applying}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!canApply}
          aria-describedby={whyNot === null ? undefined : "apply-why"}
          onClick={() => void apply()}
        >
          {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
          {applyLabel}
        </button>
        {whyNot === null ? null : <span id="apply-why" className="sr-only">{whyNot}</span>}
      </footer>
    </section>
  );
}
