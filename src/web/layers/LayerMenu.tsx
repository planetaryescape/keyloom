import { ArrowLeft, ArrowRight, Copy, Ellipsis, Eraser, GitMerge, PaintBucket, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { LAYER_COLOR_COUNT, SHORT_LABEL_MAX, cleanShortLabel, layerColorOf, layerShortLabel } from "../../layout/layer-ops.ts";
import { conditionsThatTurnOn, removeConditionalLayerChange } from "../../layout/conditional-layers.ts";
import type { ChangeOp } from "../../layout/change.ts";
import type { ConditionalLayer, Layer, Layout } from "../../layout/schema.ts";
import { niceLayerName } from "../../layout/layer-ops.ts";
import type { ChangeOutcome } from "../editor/useChange.ts";
import { conditionSummary, newConditionChange, pickerChoices, setPickerChange } from "./conditional-ops.ts";

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
  /** Raised by the strip's link on this layer's tab: opens the menu on the conditions. */
  openWhen: number;
}

// The active tab's actions. The popover is position: fixed because the tab strip scrolls sideways and
// would clip an absolute one (the ARIA menu button pattern, like shell/Menu.tsx).
export function LayerMenu(props: LayerMenuProps) {
  const { layout, layers, index, transparentCount, noneCount, disabledReason, onRename, onDuplicate, onMove, onStyle, onConvert, onDelete, onCondition, openWhen } = props;
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
    (view === "list" ? root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)') : root.current?.querySelector<HTMLElement>(view === "look" ? "input" : "select, button:not(:disabled)"))?.focus();
  }, [open, view]);

  // The strip's link asks for the conditions; the first render keeps the value it starts with, so it opens nothing.
  const asked = useRef(openWhen);
  useEffect(() => {
    if (asked.current === openWhen) return;
    asked.current = openWhen;
    place();
    setView("when");
    setOpen(true);
  }, [openWhen]);

  if (layer === undefined) return null;

  function place() {
    if (button.current === null) return;
    const box = button.current.getBoundingClientRect();
    // Opens above the button, since the layer strip is at the foot of the stage; under it when there's no room above. Kept inside the window.
    const left = Math.max(8, Math.min(box.left, window.innerWidth - 308));
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
        <div id={id} className="menu-list layer-menu-list" role={view === "list" ? "menu" : "dialog"} aria-label={view === "list" ? "Layer actions" : view === "look" ? "Label and colour" : "Also on when"} style={at}>
          {disabledReason !== null ? <p className="menu-heading">{disabledReason}</p> : null}
          {view === "list" ? (
            <>
              {item("Rename", <Pencil size={14} aria-hidden="true" />, onRename, disabledReason !== null)}
              {item("Duplicate", <Copy size={14} aria-hidden="true" />, onDuplicate, disabledReason !== null)}
              {item("Move left", <ArrowLeft size={14} aria-hidden="true" />, () => onMove(index - 1), disabledReason !== null || index <= 1, index <= 1 ? "The base layer stays first" : undefined)}
              {item("Move right", <ArrowRight size={14} aria-hidden="true" />, () => onMove(index + 1), disabledReason !== null || index === 0 || index === last)}
              <button type="button" role="menuitem" className="menu-item" disabled={disabledReason !== null} onClick={() => setView("look")}>
                <PaintBucket size={14} aria-hidden="true" />
                <span className="menu-item-label">Label and colour</span>
                <span className="layer-menu-hint">{layerShortLabel(layer)}</span>
              </button>
              <button type="button" role="menuitem" className="menu-item" disabled={disabledReason !== null} onClick={() => setView("when")}>
                <GitMerge size={14} aria-hidden="true" />
                <span className="menu-item-label">Also on when ... are held</span>
                <span className="layer-menu-hint">{conditions.length === 0 ? "None" : conditions.length}</span>
              </button>
              <p className="menu-heading">Every key on this layer</p>
              {item(`Transparent to none (${transparentCount})`, <Eraser size={14} aria-hidden="true" />, () => onConvert("transparent", "none"), disabledReason !== null || transparentCount === 0, transparentCount === 0 ? "No transparent keys here" : undefined)}
              {item(`None to transparent (${noneCount})`, <Eraser size={14} aria-hidden="true" />, () => onConvert("none", "transparent"), disabledReason !== null || noneCount === 0, noneCount === 0 ? "No none keys here" : undefined)}
              <hr className="menu-rule" />
              {item("Delete layer", <Trash2 size={14} aria-hidden="true" />, onDelete, disabledReason !== null || index === 0, index === 0 ? "The base layer can't be deleted" : undefined)}
            </>
          ) : view === "when" ? (
            <WhenForm layout={layout} layer={layer} conditions={conditions} onCondition={onCondition} onBack={() => setView("list")} />
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
      <label htmlFor={labelId}>Short label <span className="muted">Up to {SHORT_LABEL_MAX} characters</span></label>
      <input id={labelId} value={label} maxLength={SHORT_LABEL_MAX} placeholder={layerShortLabel({ name: layer.name })} onChange={(event) => setLabel(event.target.value)} />
      <fieldset className="layer-swatches">
        <legend>Colour</legend>
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

// The conditions that turn this layer on: "Also on when [A] and [B] are held". Each edit is one change the validator judges, and a
// refusal is shown here, in place, since the picker that caused it is what the person is looking at.
function WhenForm({ layout, layer, conditions, onCondition, onBack }: { layout: Layout; layer: Layer; conditions: ConditionalLayer[]; onCondition: LayerMenuProps["onCondition"]; onBack: () => void }) {
  const [refused, setRefused] = useState<Extract<ChangeOutcome, { ok: false }> | null>(null);
  const [busy, setBusy] = useState(false);
  const name = niceLayerName(layer.name);
  const add = newConditionChange(layout, layer.id);

  async function run(ops: ChangeOp[], summary: string) {
    setBusy(true);
    const outcome = await onCondition(ops, summary);
    setBusy(false);
    setRefused(outcome.ok ? null : outcome);
  }

  return (
    <div className="layer-when">
      <p className="layer-when-lead">{name} is also on when two other layers are both held.</p>
      {conditions.length === 0 ? <p className="layer-when-none muted">No condition yet.</p> : null}
      {conditions.map((condition) => (
        <fieldset key={condition.id} className="layer-when-row" disabled={busy}>
          <legend>Also on when</legend>
          {([0, 1] as const).map((slot) => (
            <span key={slot} className="layer-when-pick">
              {slot === 1 ? <span aria-hidden="true">and</span> : null}
              <select
                aria-label={slot === 0 ? `First layer held, for ${name}` : `Second layer held, for ${name}`}
                value={condition.ifLayerIds[slot]}
                onChange={(event) => {
                  const change = setPickerChange(condition, slot, event.target.value);
                  if (change !== null) void run(change.ops, conditionSummary(layout, change.next, "Changed"));
                }}
              >
                {pickerChoices(layout, condition, slot).map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
              </select>
            </span>
          ))}
          <span className="layer-when-end">
            <span>are held</span>
            <button type="button" className="button" onClick={() => void run(removeConditionalLayerChange(condition.id), conditionSummary(layout, condition, "Removed"))}>Remove</button>
          </span>
        </fieldset>
      ))}
      {refused === null ? null : (
        <div className="layer-refused" role="alert">
          <strong>{refused.message}</strong>
          {refused.problems.length === 0 ? null : <ul>{refused.problems.slice(0, 4).map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        </div>
      )}
      <div className="layer-look-foot">
        <button type="button" className="button" onClick={onBack}>Back</button>
        <button type="button" className="button" disabled={busy || "reason" in add} onClick={() => !("reason" in add) && void run(add.ops, conditionSummary(layout, (add.ops[0] as { conditionalLayer: ConditionalLayer }).conditionalLayer, "Added"))}>
          <Plus size={14} aria-hidden="true" /> Add a condition
        </button>
      </div>
      {"reason" in add ? <p className="layer-when-none muted">{add.reason}.</p> : null}
    </div>
  );
}
