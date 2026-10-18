import { ArrowLeft, ArrowRight, Copy, Ellipsis, Eraser, GitMerge, PaintBucket, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { LAYER_COLOR_COUNT, SHORT_LABEL_MAX, cleanShortLabel, layerColorOf, layerShortLabel } from "../../layout/layer-ops.ts";
import { conditionsThatTurnOn, removeConditionalLayerChange } from "../../layout/conditional-layers.ts";
import type { ChangeOp } from "../../layout/change.ts";
import type { ConditionalLayer, Layer, Layout } from "../../layout/schema.ts";
import { niceLayerName } from "../../layout/layer-ops.ts";
import type { ChangeOutcome } from "../editor/useChange.ts";
import { conditionSummary, draftChange, draftChoices, noNewCondition, pickerChoices, setPickerChange } from "./conditional-ops.ts";

export interface LayerMenuProps {
  layout: Layout;
  layers: readonly Layer[];
  index: number;
  transparentCount: number;
  noneCount: number;
  disabledReason: string | null;
  onRename: () => void;
  onDuplicate: () => void;
  onMove: (toIndex: number) => void;
  onStyle: (label: string | null, color: number | null) => void;
  onConvert: (from: "transparent" | "none", to: "transparent" | "none") => void;
  onDelete: () => void;
  /** Applies a change to the conditions; the outcome says whether the validator refused it. */
  onCondition: (ops: ChangeOp[], summary: string) => Promise<ChangeOutcome>;
  /** A layer's light (a CSS colour) or null, for the dots on its chips, as the strip draws them. */
  lightOf: (layerId: string) => string | null;
}

// The active tab's actions. The popover is position: fixed because the tab strip scrolls sideways and
// would clip an absolute one (the ARIA menu button pattern, like shell/Menu.tsx).
export function LayerMenu(props: LayerMenuProps) {
  const { layout, layers, index, transparentCount, noneCount, disabledReason, onRename, onDuplicate, onMove, onStyle, onConvert, onDelete, onCondition, lightOf } = props;
  const layer = layers[index];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "look" | "when">("list");
  const [at, setAt] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    setView("list");
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (view === "list" ? root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)') : root.current?.querySelector<HTMLElement>(view === "look" ? "input" : ".layer-when-chip:not(:disabled), .layer-when-add:not(:disabled)"))?.focus();
  }, [open, view]);

  if (layer === undefined) return null;

  function place() {
    if (button.current === null) return;
    const box = button.current.getBoundingClientRect();
    // Opens above the button, since the layer strip is at the foot of the stage; under it when there's no room above. Kept inside the window.
    const left = Math.max(8, Math.min(box.left, window.innerWidth - 356));
    setAt(box.top > 360 ? { bottom: window.innerHeight - box.top + 4, left } : { top: box.bottom + 4, left });
  }

  function toggle() {
    if (!open) place();
    setOpen((value) => !value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (view !== "list") setView("list");
      else close(true);
      return;
    }
    if (view !== "list") return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const from = items.indexOf(document.activeElement as HTMLElement);
    const target = event.key === "ArrowDown" ? items[(from + 1) % items.length] : event.key === "ArrowUp" ? items[(from - 1 + items.length) % items.length] : undefined;
    if (target === undefined) return;
    event.preventDefault();
    target.focus();
  }

  const act = (run: () => void) => () => {
    close(false);
    run();
  };
  const last = layers.length - 1;
  const conditions = conditionsThatTurnOn(layout, layer.id);
  const item = (label: string, icon: React.ReactNode, run: () => void, disabled = false, why?: string) => (
    <button type="button" role="menuitem" className="menu-item" disabled={disabled} title={why} onClick={act(run)}>
      {icon}
      <span className="menu-item-label">{label}</span>
    </button>
  );

  return (
    <div className="layer-menu" ref={root} onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={button}
        type="button"
        className="icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Actions for ${niceLayerName(layer.name)}`}
        title={`Rename, copy, reorder or delete ${niceLayerName(layer.name)}`}
        onClick={toggle}
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div id={id} className="menu-list layer-menu-list" role={view === "list" ? "menu" : "dialog"} aria-label={view === "list" ? "Layer actions" : view === "look" ? "On-screen label and colour" : "Also on while two layers are held"} style={at}>
          {disabledReason !== null ? <p className="menu-heading">{disabledReason}</p> : null}
          {view === "list" ? (
            <>
              {item("Rename", <Pencil size={14} aria-hidden="true" />, onRename, disabledReason !== null)}
              {item("Duplicate", <Copy size={14} aria-hidden="true" />, onDuplicate, disabledReason !== null)}
              {item("Move left", <ArrowLeft size={14} aria-hidden="true" />, () => onMove(index - 1), disabledReason !== null || index <= 1, index <= 1 ? "The base layer stays first" : undefined)}
              {item("Move right", <ArrowRight size={14} aria-hidden="true" />, () => onMove(index + 1), disabledReason !== null || index === 0 || index === last)}
              <button type="button" role="menuitem" className="menu-item" disabled={disabledReason !== null} onClick={() => setView("look")}>
                <PaintBucket size={14} aria-hidden="true" />
                <span className="menu-item-label">On-screen label and colour</span>
                <span className="layer-menu-hint">{layerShortLabel(layer)}</span>
              </button>
              <button type="button" role="menuitem" className="menu-item" disabled={disabledReason !== null} onClick={() => setView("when")}>
                <GitMerge size={14} aria-hidden="true" />
                <span className="menu-item-label">Also on while two are held</span>
                <span className="layer-menu-hint">{conditions.length === 0 ? "None" : conditions.length}</span>
              </button>
              <p className="menu-heading">Every key on this layer</p>
              {item(`Transparent to none (${transparentCount})`, <Eraser size={14} aria-hidden="true" />, () => onConvert("transparent", "none"), disabledReason !== null || transparentCount === 0, transparentCount === 0 ? "No transparent keys here" : undefined)}
              {item(`None to transparent (${noneCount})`, <Eraser size={14} aria-hidden="true" />, () => onConvert("none", "transparent"), disabledReason !== null || noneCount === 0, noneCount === 0 ? "No none keys here" : undefined)}
              <hr className="menu-rule" />
              {item("Delete layer", <Trash2 size={14} aria-hidden="true" />, onDelete, disabledReason !== null || index === 0, index === 0 ? "The base layer can't be deleted" : undefined)}
            </>
          ) : view === "when" ? (
            <WhenForm layout={layout} layer={layer} conditions={conditions} onCondition={onCondition} lightOf={lightOf} onBack={() => setView("list")} />
          ) : (
            <LookForm layer={layer} colorIndex={layerColorOf(layers, index)} onBack={() => setView("list")} onSave={(label, color) => { close(true); onStyle(label, color); }} />
          )}
        </div>
      ) : null}
    </div>
  );
}

// The short label and the colour of a layer, saved together as one change.
function LookForm({ layer, colorIndex, onBack, onSave }: { layer: Layer; colorIndex: number; onBack: () => void; onSave: (label: string | null, color: number | null) => void }) {
  const [label, setLabel] = useState(layer.shortLabel ?? "");
  const [color, setColor] = useState<number | null>(layer.color ?? null);
  const labelId = useId();
  const shown = color ?? colorIndex;
  return (
    <form
      className="layer-look"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(cleanShortLabel(label), color);
      }}
    >
      <p className="muted">For keyloom&rsquo;s display, not keyboard LEDs. LED lighting is separate in Settings.</p>
      <p className="muted">Saved with this config. Saving may trigger auto-sync to your keyboard.</p>
      <label htmlFor={labelId}>Short label <span className="muted">Up to {SHORT_LABEL_MAX} characters</span></label>
      <input id={labelId} value={label} maxLength={SHORT_LABEL_MAX} placeholder={layerShortLabel({ name: layer.name })} onChange={(event) => setLabel(event.target.value)} />
      <fieldset className="layer-swatches">
        <legend>On-screen colour</legend>
        {Array.from({ length: LAYER_COLOR_COUNT }, (_, n) => n + 1).map((n) => (
          <label key={n} className="layer-swatch" style={{ "--swatch": `var(--layer-${n})` } as CSSProperties}>
            <input type="radio" name="layer-color" checked={shown === n} onChange={() => setColor(n)} aria-label={`Colour ${n}`} />
            <span aria-hidden="true" />
          </label>
        ))}
      </fieldset>
      <div className="layer-look-foot">
        <button type="button" className="button" onClick={onBack}>Back</button>
        <button type="submit" className="button button-primary">Save</button>
      </div>
    </form>
  );
}

// The conditions that turn this layer on, as a sentence with the layers as chips: "Adjust is also on while [Lower] and [Raise] are
// held" (D-389). A chip opens the other layers below the sentence, as chips drawn the way the strip draws them. Each edit is one change
// the validator judges, and a refusal shows here, where the choice was made. A new condition is a draft until both layers are chosen,
// so nothing is applied that BK didn't pick.
type Opened = { key: string; slot: 0 | 1 };

function WhenForm({ layout, layer, conditions, onCondition, lightOf, onBack }: { layout: Layout; layer: Layer; conditions: ConditionalLayer[]; onCondition: LayerMenuProps["onCondition"]; lightOf: LayerMenuProps["lightOf"]; onBack: () => void }) {
  const [refused, setRefused] = useState<Extract<ChangeOutcome, { ok: false }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<[string | null, string | null] | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const chooserId = useId();
  const box = useRef<HTMLDivElement>(null);
  // Focus follows the choice: into the layers when a chip opens them, back to that chip when they close, so a keyboard keeps its
  // place while the view re-renders under it. The view's first focus is the menu's (on opening the view).
  const last = useRef<Opened | null>(null);
  useEffect(() => {
    const root = box.current;
    const was = last.current;
    last.current = opened;
    if (root === null || (opened === null && was === null)) return;
    const target =
      opened !== null
        ? root.querySelector<HTMLElement>(`#${CSS.escape(chooserId)} [aria-checked="true"]`) ?? root.querySelector<HTMLElement>(`#${CSS.escape(chooserId)} .layer-when-option`)
        : root.querySelector<HTMLElement>(`[data-chip="${was?.key}:${was?.slot}"]`) ?? root.querySelector<HTMLElement>(".layer-when-chip, .layer-when-add");
    target?.focus();
  }, [opened, chooserId]);
  const name = niceLayerName(layer.name);
  const nameOf = (id: string | null) => (id === null ? null : niceLayerName(layout.layers.find((l) => l.id === id)?.name ?? id));
  const cannotAdd = noNewCondition(layout, layer.id);

  async function run(ops: ChangeOp[], summary: string): Promise<boolean> {
    setBusy(true);
    const outcome = await onCondition(ops, summary);
    setBusy(false);
    setRefused(outcome.ok ? null : outcome);
    return outcome.ok;
  }

  const dot = (id: string) => {
    const light = lightOf(id);
    return <span className="layer-dot" data-unlit={light === null} aria-hidden="true" style={light === null ? undefined : { background: light, boxShadow: `0 0 6px ${light}` }} />;
  };

  const chip = (key: string, slot: 0 | 1, layerId: string | null) => {
    const isOpen = opened?.key === key && opened.slot === slot;
    return (
      <button
        type="button"
        className="layer-when-chip"
        data-chip={`${key}:${slot}`}
        data-empty={layerId === null || undefined}
        aria-expanded={isOpen}
        aria-controls={isOpen ? chooserId : undefined}
        aria-label={layerId === null ? `Choose the ${slot === 0 ? "first" : "second"} layer` : `${nameOf(layerId)}, the ${slot === 0 ? "first" : "second"} layer. Change it`}
        disabled={busy}
        onClick={() => setOpened(isOpen ? null : { key, slot })}
      >
        {layerId === null ? null : dot(layerId)}
        {nameOf(layerId) ?? "which layer?"}
      </button>
    );
  };

  const chooser = (other: string | null, choices: Array<{ id: string; name: string }>, current: string | null, onPick: (id: string) => void) => (
    <div className="layer-when-choose" id={chooserId}>
      <p>{other === null ? "Hold this layer and another:" : `Hold ${nameOf(other)} and…`}</p>
      <div className="layer-when-options" role="radiogroup" aria-label="Which layer">
        {choices.map((choice) => (
          <button key={choice.id} type="button" role="radio" className="layer-when-option" aria-checked={choice.id === current} disabled={busy} onClick={() => onPick(choice.id)}>
            {dot(choice.id)}
            {choice.name}
          </button>
        ))}
      </div>
    </div>
  );

  function pickDraft(slot: 0 | 1, id: string) {
    if (draft === null) return;
    const next: [string | null, string | null] = slot === 0 ? [id, draft[1]] : [draft[0], id];
    if (next[0] === null || next[1] === null) {
      setDraft(next);
      setOpened({ key: "draft", slot: next[0] === null ? 0 : 1 });
      return;
    }
    const change = draftChange(layout, layer.id, [next[0], next[1]]);
    if ("reason" in change) {
      setDraft(next);
      setRefused({ ok: false, message: change.reason, problems: [], lost: [], stale: false });
      return;
    }
    void run(change.ops, conditionSummary(layout, change.condition, "Added")).then((ok) => {
      if (!ok) return;
      setDraft(null);
      setOpened(null);
    });
  }

  return (
    <div className="layer-when" ref={box}>
      <div className="layer-when-head">
        <button type="button" className="icon-button" aria-label="Back to the layer's actions" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /></button>
        <h3>Also on while two layers are held</h3>
      </div>
      {conditions.length === 0 && draft === null ? (
        <p className="layer-when-lead">{name} is on only while a key holds it. It can also come on by itself whenever two other layers are held together, the way an Adjust layer comes on under Lower and Raise.</p>
      ) : null}
      {conditions.map((condition) => {
        const [a, b] = condition.ifLayerIds as [string, string];
        const open = opened?.key === condition.id ? opened.slot : null;
        return (
          <div key={condition.id} className="layer-when-condition">
            <p className="layer-when-sentence"><b>{name}</b> is also on while {chip(condition.id, 0, a)} and {chip(condition.id, 1, b)} are held.</p>
            {open === null ? null : chooser(open === 0 ? b : a, pickerChoices(layout, condition, open), open === 0 ? a : b, (id) => {
              const change = setPickerChange(condition, open, id);
              if (change === null) return setOpened(null);
              void run(change.ops, conditionSummary(layout, change.next, "Changed")).then((ok) => ok && setOpened(null));
            })}
            <div className="layer-when-row">
              <span>Both held, from any keys that hold them.</span>
              <button type="button" className="layer-when-quiet" disabled={busy} onClick={() => void run(removeConditionalLayerChange(condition.id), conditionSummary(layout, condition, "Removed"))}>
                <X size={13} aria-hidden="true" />Remove
              </button>
            </div>
          </div>
        );
      })}
      {draft === null ? null : (
        <div className="layer-when-condition">
          <p className="layer-when-sentence"><b>{name}</b> is also on while {chip("draft", 0, draft[0])} and {chip("draft", 1, draft[1])} are held.</p>
          {opened?.key !== "draft" ? null : chooser(opened.slot === 0 ? draft[1] : draft[0], draftChoices(layout, layer.id, opened.slot === 0 ? draft[1] : draft[0]), draft[opened.slot], (id) => pickDraft(opened.slot, id))}
          <div className="layer-when-row">
            <span>Nothing changes until both are chosen.</span>
            <button type="button" className="layer-when-quiet" disabled={busy} onClick={() => { setDraft(null); setOpened(null); setRefused(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {refused === null ? null : (
        <div className="layer-refused" role="alert">
          <strong>{refused.message}</strong>
          {refused.problems.length === 0 ? null : <ul>{refused.problems.slice(0, 4).map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        </div>
      )}
      {draft !== null ? null : (
        <>
          <button
            type="button"
            className="layer-when-add"
            disabled={busy || cannotAdd !== null}
            onClick={() => {
              setRefused(null);
              setDraft([null, null]);
              setOpened({ key: "draft", slot: 0 });
            }}
          >
            <Plus size={14} aria-hidden="true" />
            {conditions.length === 0 ? "Turn it on while two layers are held" : "Another pair that turns it on"}
          </button>
          {cannotAdd === null ? null : <p className="layer-when-note">{cannotAdd}.</p>}
        </>
      )}
    </div>
  );
}
