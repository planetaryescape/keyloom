import { ArrowLeft, ArrowRight, Copy, Ellipsis, Eraser, PaintBucket, Pencil, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { LAYER_COLOR_COUNT, SHORT_LABEL_MAX, cleanShortLabel, layerColorOf, layerShortLabel } from "../../layout/layer-ops.ts";
import type { Layer } from "../../layout/schema.ts";
import { niceLayerName } from "../../layout/layer-ops.ts";

export interface LayerMenuProps {
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
}

// The active tab's actions. The popover is position: fixed because the tab strip scrolls sideways and
// would clip an absolute one (the ARIA menu button pattern, like shell/Menu.tsx).
export function LayerMenu(props: LayerMenuProps) {
  const { layers, index, transparentCount, noneCount, disabledReason, onRename, onDuplicate, onMove, onStyle, onConvert, onDelete } = props;
  const layer = layers[index];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "look">("list");
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
    (view === "list" ? root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)') : root.current?.querySelector<HTMLElement>("input"))?.focus();
  }, [open, view]);

  if (layer === undefined) return null;

  function toggle() {
    if (!open && button.current !== null) {
      const box = button.current.getBoundingClientRect();
      // Opens under the button, kept inside the window on a phone.
      setAt({ top: box.bottom + 4, left: Math.max(8, Math.min(box.left, window.innerWidth - 268)) });
    }
    setOpen((value) => !value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (view === "look") setView("list");
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
        <div id={id} className="menu-list layer-menu-list" role={view === "list" ? "menu" : "dialog"} aria-label={view === "list" ? "Layer actions" : "Label and colour"} style={at}>
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
              <p className="menu-heading">Every key on this layer</p>
              {item(`Transparent to none (${transparentCount})`, <Eraser size={14} aria-hidden="true" />, () => onConvert("transparent", "none"), disabledReason !== null || transparentCount === 0, transparentCount === 0 ? "No transparent keys here" : undefined)}
              {item(`None to transparent (${noneCount})`, <Eraser size={14} aria-hidden="true" />, () => onConvert("none", "transparent"), disabledReason !== null || noneCount === 0, noneCount === 0 ? "No none keys here" : undefined)}
              <hr className="menu-rule" />
              {item("Delete layer", <Trash2 size={14} aria-hidden="true" />, onDelete, disabledReason !== null || index === 0, index === 0 ? "The base layer can't be deleted" : undefined)}
            </>
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
