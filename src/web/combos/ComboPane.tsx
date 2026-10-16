import { ArrowRight, LoaderCircle, MousePointerClick, Trash2, X } from "lucide-react";
import { MiniCap, SheetHead } from "../shell/Sheet.tsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Binding, Combo, Layout } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { applyChange } from "../api-write.ts";
import { bindingFromDraft, bindingSummary, draftFromBinding, type Draft } from "../editor/draft.ts";
import { CardMods } from "../card/CardMods.tsx";
import { useOpsCheck } from "../editor/useCheck.ts";
import { Validation } from "../editor/Validation.tsx";
import type { PickerTab } from "../panel/picker-items.ts";
import { SlotPicker } from "../panel/SlotPicker.tsx";
import { canToggleTapMods, pickTap, tapMods, toggleTapMod, type TapPick } from "../panel/slots.ts";
import { comboNameFor, comboProblem, comboSummary, layersFromChoice, MIN_COMBO_KEYS, removeComboOps, upsertComboOps } from "./combo-ops.ts";
import "./combos.css";
import "../card/card.css";
import { bindingLegend } from "../../layout/legend.ts";
import { layerDisplayName } from "../../layout/cap-words.ts";
import { Cap } from "../keyboard/Cap.tsx";
import { HeroCap } from "../card/HeroCap.tsx";
import { cardTitle } from "../card/card-words.ts";

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

// A combo's keys by what they print on the first layer, the way the board shows them (D-279).
const keyLegends = (layout: Layout, positions: readonly number[]) => {
  const base = layout.layers[0];
  const ctx = { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances };
  return positions.map((position) => {
    const binding = base?.bindings[position];
    return binding === undefined ? "?" : bindingLegend(binding, ctx).tap || "blank";
  });
};
const layersText = (layout: Layout, layerIds: Combo["layerIds"]) =>
  layerIds === "all" ? "All layers" : layerIds.map((id) => layout.layers.find((layer) => layer.id === id)?.name ?? id).join(", ");

// Every combo in the layout, whatever layer is showing. Hovering a row lights its keys on the board.
export function ComboList({ layout, onOpen, onHover, onClose }: ListProps) {
  return (
    <section className="combo-pane" aria-label="Combos">
      <SheetHead
        title="Combos"
        lead={layout.combos.length === 0 ? "Keys pressed together that send something else." : "Keys pressed together that send something else. Point at one to see it on the board."}
        closeLabel="Close the combos list"
        onClose={onClose}
      />
      <div className="sheet-body">
        {layout.combos.length === 0 ? (
          <p className="sheet-empty">None yet. Shift-click two or more keys on the board, then choose Make a combo.</p>
        ) : (
          <ul className="sheet-rows">
            {layout.combos.map((combo) => {
              const legends = keyLegends(layout, combo.positions);
              const sends = bindingSummary(combo.output, layout);
              return (
                <li key={combo.id}>
                  <button
                    type="button"
                    className="sheet-row"
                    aria-label={`${legends.join(" and ")} together send ${sends}`}
                    onClick={() => onOpen(combo)}
                    onPointerEnter={() => onHover(combo.id)}
                    onPointerLeave={() => onHover(null)}
                    onFocus={() => onHover(combo.id)}
                    onBlur={() => onHover(null)}
                  >
                    <span className="mini-caps">
                      {legends.map((legend, i) => (
                        <span key={`${combo.positions[i]}`} className="mini-caps">
                          {i === 0 ? null : <span className="plus" aria-hidden="true">+</span>}
                          <MiniCap>{legend}</MiniCap>
                        </span>
                      ))}
                      <ArrowRight size={13} className="combo-arrow" aria-hidden="true" />
                      <span className="sheet-row-title combo-sends">{sends}</span>
                    </span>
                    <span className="sheet-row-meta">{layersText(layout, combo.layerIds)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
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

  // The keys as their caps show on this layer, and what they send as a cap of its own (23#the-key-card, P2).
  const ctx = { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances, passthrough: layout.passthrough };
  const layer = layout.layers.find((candidate) => candidate.id === layerId);
  const keyLegends = draft.positions.map((position) => {
    const binding = layer?.bindings[position];
    return binding === undefined ? { kind: "none" as const, tap: "" } : bindingLegend(binding, ctx);
  });
  // A macro's cap shortens what it sends ("⌘…"); the combo's hero has room to show every key it taps (P2 review).
  const outputLegend = (() => {
    if (draft.output === null) return null;
    const legend = bindingLegend(draft.output, ctx);
    if (draft.output.kind !== "macro") return legend;
    const output = draft.output;
    const steps = layout.macros.find((macro) => macro.id === output.macroId)?.steps ?? [];
    const taps = steps.flatMap((step) => (step.op === "tap" && step.code !== undefined ? [bindingLegend({ kind: "key", code: step.code, ...(step.mods === undefined ? {} : { mods: step.mods }) }, ctx).tap] : []));
    return taps.length === 0 ? legend : { ...legend, tap: taps.join(" ") };
  })();
  const title = draft.positions.length === 0 ? "New combo" : keyLegends.map((legend, i) => legend.tap || "a blank key").join(" + ");
  const where = draft.layerIds === "all" ? "every layer" : draft.layerIds.map((id) => layerDisplayName(layout.layers.find((candidate) => candidate.id === id)?.name ?? id)).join(", ");
  const applyText = applying ? "Applying" : draft.output === null ? (draft.isNew ? "Add combo" : "Apply") : `Send ${cardTitle(draft.output, layout)} from ${title}`;

  return (
    <section ref={root} className="combo-pane combo-editor key-card" aria-label={draft.isNew ? "New combo" : `Combo ${draft.name}`}>
      <header className="card-head">
        <div className="card-heading">
          <h2>{title}</h2>
          <p>{draft.isNew ? "New combo" : "Combo"} · {where}</p>
        </div>
        <div className="card-tools">
          {draft.isNew ? null : confirmDelete ? (
            <button type="button" className="card-chip card-chip-danger" disabled={applying} onClick={() => void save({ ops: removeComboOps(draft.id), summary: comboSummary(layout, layout.combos.find((c) => c.id === draft.id) ?? (combo as Combo), "Removed") })}>
              Delete for good
            </button>
          ) : (
            <button type="button" className="card-icon" aria-label="Delete this combo" title="Delete this combo" disabled={applying} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="card-icon" aria-label="Close the combo" title="Close (Esc)" onClick={onBack}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="card-scroll">
      <fieldset className="card-body" disabled={applying}>
        <div className="combo-hero" aria-label={`${title} pressed together`}>
          {keyLegends.map((legend, i) => (
            <span key={draft.positions[i]} className="combo-hero-key">
              {i === 0 ? null : <span className="combo-hero-op" aria-hidden="true">+</span>}
              <Cap as="span" tone={legend.kind} legend={legend} unit={56} width={1} style={{ width: 56, height: 56 }} />
            </span>
          ))}
          <span className="combo-hero-op" aria-hidden="true">→</span>
          <HeroCap
            legend={outputLegend ?? { tap: "" }}
            tone={outputLegend?.kind ?? "none"}
            hold={null}
            doubleTap={null}
            tapThenHold={null}
            open={pickerOpen ? "tap" : null}
            draft={!same && draft.output !== null}
            onOpen={() => setPickerOpen((open) => !open)}
            label={draft.output === null ? "Choose what they send" : `Sends ${summaryWord}`}
            size={72}
          />
        </div>
        <p className="card-sentence">
          {draft.output === null ? "Pick what these keys send together." : `Press them together for ${summaryWord}.`}
          {picking ? " Click keys on the board to add or remove them." : ""}
        </p>
        <div className="card-chips">
          <button type="button" className="card-chip" aria-pressed={picking} onClick={() => onPicking(!picking)}>
            <MousePointerClick size={13} aria-hidden="true" />
            {picking ? "Done choosing keys" : "Change keys"}
          </button>
          {picking
            ? draft.positions.map((position) => (
                <button key={position} type="button" className="card-chip" disabled={tooFew} title={tooFew ? "A combo needs at least two keys" : undefined} onClick={() => onDraft({ ...draft, positions: draft.positions.filter((candidate) => candidate !== position) })}>
                  Remove this key
                </button>
              ))
            : null}
        </div>

        <div className="card-picker combo-sends" hidden={!pickerOpen && !canToggleTapMods(pickerDraft)}>
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
            <CardMods row label={pickerDraft.kind === "modifier" ? "Modifiers" : "Sent with it"} mods={tapMods(pickerDraft)} onToggle={(mod) => setOutput(toggleTapMod(pickerDraft, mod))} />
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

        {combo === null || !(check.state.status === "error" || (check.state.status === "done" && (!check.state.result.ok || check.state.result.warnings.length > 0))) ? null : (
          <Validation layout={layout} idleNote="" state={check.state} onRecheck={check.recheck} hideLost />
        )}
      </fieldset>
      </div>

      {same && error === null ? null : (
        <footer className="card-foot">
          {error !== null || (why !== null && draft.output !== null) ? (
            <p className="card-foot-note" role={error === null ? undefined : "alert"}>{error ?? why}</p>
          ) : null}
          <div className="card-foot-row">
            <button type="button" className="card-discard" disabled={applying} onClick={onBack}>
              Discard
            </button>
            <button type="button" className="card-apply" disabled={!canApply} onClick={() => combo !== null && void save({ ops: upsertComboOps(combo), summary: comboSummary(layout, combo, draft.isNew ? "Added" : "Changed") })}>
              {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
              {applyText}
              {applying ? null : <kbd aria-hidden="true">↵</kbd>}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
