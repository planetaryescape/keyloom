import { LoaderCircle, MousePointerClick, Plus, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Binding, Combo, Layout } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { applyChange } from "../api-write.ts";
import { bindingFromDraft, bindingSummary, draftFromBinding, type Draft } from "../editor/draft.ts";
import { ModifierToggles } from "../editor/ModifierToggles.tsx";
import { useOpsCheck } from "../editor/useCheck.ts";
import { Validation } from "../editor/Validation.tsx";
import type { PickerTab } from "../panel/picker-items.ts";
import { SlotPicker } from "../panel/SlotPicker.tsx";
import { canToggleTapMods, pickTap, tapMods, toggleTapMod, type TapPick } from "../panel/slots.ts";
import { comboNameFor, comboProblem, comboSummary, layersFromChoice, MIN_COMBO_KEYS, removeComboOps, upsertComboOps } from "./combo-ops.ts";
import "./combos.css";

/** A combo being made or edited. The output is null until the person picks one, and nothing is saved before then. */
export interface ComboDraft {
  id: string;
  isNew: boolean;
  name: string;
  positions: number[];
  layerIds: Combo["layerIds"];
  output: Binding | null;
  timeoutMs: number | undefined;
}

export function draftFromCombo(combo: Combo): ComboDraft {
  return { id: combo.id, isNew: false, name: combo.name, positions: [...combo.positions], layerIds: combo.layerIds, output: combo.output, timeoutMs: combo.timeoutMs };
}

interface ListProps {
  layout: Layout;
  onOpen: (combo: Combo) => void;
  onHover: (id: string | null) => void;
  onClose: () => void;
}

const keysText = (positions: readonly number[]) => positions.map((position) => position + 1).join(" + ");
const layersText = (layout: Layout, layerIds: Combo["layerIds"]) =>
  layerIds === "all" ? "All layers" : layerIds.map((id) => layout.layers.find((layer) => layer.id === id)?.name ?? id).join(", ");

// Every combo in the layout, whatever layer is showing. Hovering a row lights its keys on the board.
export function ComboList({ layout, onOpen, onHover, onClose }: ListProps) {
  return (
    <section className="combo-pane" aria-label="Combos">
      <header className="panel-head">
        <div className="panel-title">
          <h2>Combos</h2>
          <p className="muted">{layout.combos.length === 0 ? "None yet" : `${layout.combos.length} in this layout`}</p>
        </div>
        <button type="button" className="icon-button" aria-label="Close the combos list" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {layout.combos.length === 0 ? (
        <p className="muted combo-lead">No combos yet. Select two or more keys (Shift-click), then choose Make a combo.</p>
      ) : (
        <>
          <p className="muted combo-lead">Hover a row to see its keys on the board.</p>
          <ul className="combo-rows">
            {layout.combos.map((combo) => (
              <li key={combo.id}>
                <button
                  type="button"
                  className="combo-row"
                  onClick={() => onOpen(combo)}
                  onPointerEnter={() => onHover(combo.id)}
                  onPointerLeave={() => onHover(null)}
                  onFocus={() => onHover(combo.id)}
                  onBlur={() => onHover(null)}
                >
                  <strong>{combo.name}</strong>
                  <span>Keys {keysText(combo.positions)} send {bindingSummary(combo.output, layout)}</span>
                  <span className="muted">{layersText(layout, combo.layerIds)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface EditorProps {
  token: string;
  layoutRef: string;
  revisionId: string;
  layout: Layout;
  /** The layer on the board, which the picker excludes nothing for but needs to number layer choices. */
  layerId: string;
  draft: ComboDraft;
  onDraft: (draft: ComboDraft) => void;
  /** While picking, clicks on the board add and remove this combo's keys. */
  picking: boolean;
  onPicking: (on: boolean) => void;
  onBack: () => void;
  onApplied: (summary: string) => Promise<void>;
  onStale: () => void;
}

// A combo's own panel: the output with the key panel's picker, the keys (picked on the board), the
// layers and the timeout (16#combos-are-made-from-a-selection).
export function ComboEditor({ token, layoutRef, revisionId, layout, layerId, draft, onDraft, picking, onPicking, onBack, onApplied, onStale }: EditorProps) {
  const [pickerOpen, setPickerOpen] = useState(draft.output === null);
  // Esc, Tab, Backspace and Enter are what combos usually send, and they live on Navigation, so the picker opens there.
  const [tab, setTab] = useState<PickerTab>("navigation");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const root = useRef<HTMLElement>(null);
  const nameId = useId();
  const timeoutId = useId();

  // The picker works on a Draft of the output; the combo keeps the Binding it builds.
  const [pickerDraft, setPickerDraft] = useState<Draft>(() => draftFromBinding(draft.output ?? { kind: "none" }, layout, layerId));
  const outputKey = JSON.stringify(draft.output);
  useEffect(() => {
    setPickerDraft(draftFromBinding(draft.output ?? { kind: "none" }, layout, layerId));
    // Only when the output itself changes from outside (a reset), never on each keystroke of another field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputKey]);

  function setOutput(next: Draft) {
    setPickerDraft(next);
    setError(null);
    const binding = bindingFromDraft(next, layout);
    onDraft({ ...draft, output: binding });
  }

  const combo: Combo | null = useMemo(() => {
    if (draft.output === null) return null;
    const name = draft.name.trim() === "" ? comboNameFor(layout, draft.output, draft.isNew ? undefined : draft.id) : draft.name.trim();
    return {
      id: draft.id,
      name,
      positions: [...draft.positions].sort((a, b) => a - b),
      layerIds: draft.layerIds,
      output: draft.output,
      ...(draft.timeoutMs === undefined ? {} : { timeoutMs: draft.timeoutMs }),
    };
  }, [draft, layout]);

  const problem = combo === null ? null : comboProblem(layout, combo, draft.isNew);
  const ops = combo !== null && problem === null ? upsertComboOps(combo) : null;
  const check = useOpsCheck({ token, layoutRef, revisionId, ops });
  const result = check.state.status === "done" ? check.state.result : null;
  const same = combo !== null && !draft.isNew && JSON.stringify(layout.combos.find((candidate) => candidate.id === draft.id)) === JSON.stringify(combo);
  const canApply = combo !== null && problem === null && result !== null && result.ok && !applying && !same;
  const why =
    draft.output === null ? "Pick what the keys send." : problem ?? (same ? "Nothing has changed." : check.state.status === "checking" ? "Checking the change." : result !== null && !result.ok ? "Fix the errors above first." : null);

  async function save(change: { ops: ReturnType<typeof upsertComboOps>; summary: string }) {
    setApplying(true);
    setError(null);
    try {
      await applyChange(token, layoutRef, { baseRevisionId: revisionId, ops: change.ops, summary: change.summary });
      await onApplied(change.summary);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && caught.code?.startsWith("stale")) onStale();
      else if (caught instanceof ApiError) {
        if (caught.validation !== undefined) check.show(caught.validation);
        setError(caught.validation === undefined ? caught.message : "This change has problems, listed above. Nothing was saved.");
      } else setError("The change could not be applied.");
    } finally {
      setApplying(false);
    }
  }

  const toggleLayer = (id: string) => {
    const current = draft.layerIds === "all" ? layout.layers.map((layer) => layer.id) : draft.layerIds;
    const next = current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id];
    const layers = layersFromChoice(layout, next);
    // Unticking the last layer leaves the combo nowhere to work, so the box stays ticked.
    if (layers !== null) onDraft({ ...draft, layerIds: layers });
  };

  const tooFew = draft.positions.length <= MIN_COMBO_KEYS;
  const summaryWord = draft.output === null ? "Choose a key" : bindingSummary(draft.output, layout);

  return (
    <section ref={root} className="combo-pane combo-editor" aria-label={draft.isNew ? "New combo" : `Combo ${draft.name}`}>
      <header className="panel-head">
        <div className="panel-title">
          <h2>{draft.isNew ? "New combo" : draft.name}</h2>
          <p className="muted">{draft.positions.length} keys pressed together</p>
        </div>
        <button type="button" className="icon-button" aria-label="Close the combo" onClick={onBack}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <fieldset className="panel-body" disabled={applying}>
        <div className="combo-section">
          <h3>Keys</h3>
          <ul className="combo-keys" aria-label="Keys in this combo">
            {draft.positions.map((position) => (
              <li key={position}>
                <span className="combo-key">Key {position + 1}</span>
                {picking ? (
                  <button type="button" className="icon-button" aria-label={`Remove key ${position + 1}`} disabled={tooFew} title={tooFew ? "A combo needs at least two keys" : undefined} onClick={() => onDraft({ ...draft, positions: draft.positions.filter((candidate) => candidate !== position) })}>
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <button type="button" className="button" aria-pressed={picking} onClick={() => onPicking(!picking)}>
            <MousePointerClick size={14} aria-hidden="true" />
            {picking ? "Done picking keys" : "Change keys on the board"}
          </button>
          {picking ? <p className="muted">Click keys on the board to add or remove them.</p> : null}
        </div>

        <div className="combo-section">
          <h3>Sends</h3>
          <div className="slot" data-open={pickerOpen}>
            <button type="button" className="slot-main" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
              <span className="slot-label">When pressed together</span>
              <span className="slot-value">{summaryWord}</span>
            </button>
          </div>
          {pickerOpen ? (
            <SlotPicker
              slot="tap"
              tab={tab}
              onTab={setTab}
              layout={layout}
              layerId={layerId}
              keysOnly={false}
              advanced={false}
              selectedIds={new Set()}
              initialLayerAction={pickerDraft.layerAction}
              autoFocus={draft.isNew}
              token={token}
              layoutRef={layoutRef}
              position={draft.positions[0] ?? 0}
              onPick={(choice: TapPick) => {
                setOutput(pickTap(pickerDraft, choice));
                setPickerOpen(false);
              }}
              onUseBinding={(parsed) => {
                setOutput(draftFromBinding(parsed, layout, layerId));
                setPickerOpen(false);
              }}
            />
          ) : null}
          {!pickerOpen && canToggleTapMods(pickerDraft) ? (
            <ModifierToggles legend={pickerDraft.kind === "modifier" ? "Modifiers" : "Sent together with it"} mods={tapMods(pickerDraft)} onToggle={(mod) => setOutput(toggleTapMod(pickerDraft, mod))} />
          ) : null}
        </div>

        <details className="combo-more">
          <summary>More</summary>
          <div className="combo-section">
            <label htmlFor={nameId}>Name <span className="muted">Optional</span></label>
            <input id={nameId} value={draft.name} maxLength={60} placeholder={draft.output === null ? "Named from what it sends" : comboNameFor(layout, draft.output, draft.isNew ? undefined : draft.id)} onChange={(event) => onDraft({ ...draft, name: event.target.value })} />
          </div>
          <fieldset className="combo-section combo-layers">
            <legend>Works on</legend>
            <label className="combo-check">
              <input type="checkbox" checked={draft.layerIds === "all"} onChange={() => onDraft({ ...draft, layerIds: draft.layerIds === "all" ? [layerId] : "all" })} />
              All layers
            </label>
            {layout.layers.map((layer) => (
              <label key={layer.id} className="combo-check">
                <input type="checkbox" checked={draft.layerIds === "all" || draft.layerIds.includes(layer.id)} onChange={() => toggleLayer(layer.id)} />
                {layer.name}
              </label>
            ))}
          </fieldset>
          <div className="combo-section">
            <label htmlFor={timeoutId}>Timeout in milliseconds <span className="muted">Blank uses the firmware&apos;s</span></label>
            <input
              id={timeoutId}
              type="number"
              min={1}
              max={1000}
              inputMode="numeric"
              value={draft.timeoutMs ?? ""}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                onDraft({ ...draft, timeoutMs: Number.isFinite(value) && value > 0 ? value : undefined });
              }}
            />
          </div>
        </details>

        {combo === null ? null : <Validation layout={layout} idleNote="" state={check.state} onRecheck={check.recheck} hideLost />}
      </fieldset>

      <footer className="panel-foot">
        <div className="panel-foot-note" aria-live="polite">
          {error !== null ? <p className="blocked" role="alert">{error}</p> : <p className="muted">{why ?? (combo === null ? "" : comboSummary(layout, combo, draft.isNew ? "Added" : "Changed"))}</p>}
        </div>
        {draft.isNew ? null : confirmDelete ? (
          <button type="button" className="button button-danger" disabled={applying} onClick={() => void save({ ops: removeComboOps(draft.id), summary: comboSummary(layout, layout.combos.find((c) => c.id === draft.id) ?? (combo as Combo), "Removed") })}>
            Delete for good
          </button>
        ) : (
          <button type="button" className="button" disabled={applying} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        )}
        <button type="button" className="button button-primary" disabled={!canApply} onClick={() => combo !== null && void save({ ops: upsertComboOps(combo), summary: comboSummary(layout, combo, draft.isNew ? "Added" : "Changed") })}>
          {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : draft.isNew ? <Plus size={14} aria-hidden="true" /> : null}
          {applying ? "Applying" : draft.isNew ? "Add combo" : "Apply"}
        </button>
      </footer>
    </section>
  );
}
