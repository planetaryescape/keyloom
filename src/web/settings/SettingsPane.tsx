import { LoaderCircle, Search } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import type { BoardDefinition } from "../../boards/schema.ts";
import { type OptionSpec, baselineOf, currentValue, optionsFor, otherSettings, sourceText } from "../../layout/firmware-options.ts";
import { type SettingEdit, settingsChange } from "../../layout/settings-ops.ts";
import type { LayerLighting, Layout } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { applyChange } from "../api-write.ts";
import { useOpsCheck } from "../editor/useCheck.ts";
import { Validation } from "../editor/Validation.tsx";
import { ColourwaySetting } from "./ColourwaySetting.tsx";
import { LightingSection } from "./LightingSection.tsx";
import { SettingRow } from "./SettingRow.tsx";
import { type LightingDraft, lightingOps, lightingWords } from "./lighting-ops.ts";
import { SheetHead } from "../shell/Sheet.tsx";
import "./settings.css";

interface Props {
  token: string;
  layoutRef: string;
  layout: Layout;
  board: BoardDefinition;
  revisionId: string;
  advanced: boolean;
  /** The staged layer colours live above, so the board can draw them before they are applied. */
  lighting: LightingDraft;
  onLighting: (layerId: string, lighting: LayerLighting | null | undefined) => void;
  currentLayerId: string;
  onShowLayer: (layerId: string) => void;
  /** The offer to read Oryx colours into the model, shown above the layer colours when there are some to read (D-193). */
  offer?: ReactNode;
  onClose: () => void;
  /** Resolves once the new layout is on screen. */
  onApplied: (summary: string) => Promise<void>;
  onStale: () => void;
  /** The drawn board's pinned colourway (D-395), applied at once and kept per board in this browser. */
  colourway: string | null;
  onColourway: (id: string | null) => void;
  boardName: string;
}

const GROUPS = ["Typing feel", "Keys", "Power", "Pairing"] as const;

// Firmware-wide options on one page, each with its default and when to change it (D-103). The edits are staged, checked by
// the validator and applied as one change set, so a slider can be moved around freely and nothing is saved until Apply.
export function SettingsPane(props: Props) {
  const { token, layoutRef, layout, board, revisionId, advanced, lighting, onLighting, onClose, onApplied, onStale } = props;
  const search = useId();
  const [filter, setFilter] = useState("");
  const [staged, setStaged] = useState<ReadonlyMap<string, number | boolean>>(new Map());
  const [applying, setApplying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const specs = useMemo(() => optionsFor(board), [board]);
  const valueOf = (spec: OptionSpec) => staged.get(spec.key) ?? currentValue(spec, layout, board);
  const edits = useMemo<SettingEdit[]>(() => specs.flatMap((spec) => (staged.has(spec.key) ? [{ spec, value: staged.get(spec.key) as number | boolean }] : [])), [specs, staged]);
  const change = useMemo(() => settingsChange(layout, board, edits), [layout, board, edits]);
  const colourOps = useMemo(() => lightingOps(layout, lighting), [layout, lighting]);
  const ops = useMemo(() => {
    const all = [...(change?.ops ?? []), ...colourOps];
    return all.length === 0 ? null : all;
  }, [change, colourOps]);
  const summary = [...(change === null ? [] : [change.summary.replace(/^Settings: /, "")]), ...lightingWords(layout, lighting)].join("; ");
  const check = useOpsCheck({ token, layoutRef, revisionId, ops });
  const result = check.state.status === "done" ? check.state.result : null;
  const canApply = ops !== null && result !== null && result.ok && !applying;

  const needle = filter.trim().toLowerCase();
  const matches = (spec: OptionSpec) => needle === "" || `${spec.label} ${spec.words} ${spec.group} ${advanced ? spec.key : ""}`.toLowerCase().includes(needle);
  const shown = specs.filter(matches);
  const others = otherSettings(layout, board).filter((s) => needle === "" || s.key.toLowerCase().includes(needle));
  const colourways = board.display?.colourways;
  const showColourway = colourways !== undefined && (needle === "" || "your keyboard's colour colourway color black white grey theme case".includes(needle));
  const showLighting = board.lighting !== undefined && (needle === "" || "layer colours lighting led rgb".includes(needle) || "colour".includes(needle));

  function stage(spec: OptionSpec, value: number | boolean) {
    setProblem(null);
    setStaged((previous) => {
      const next = new Map(previous);
      // Back to what the layout already does is no edit at all.
      if (value === currentValue(spec, layout, board)) next.delete(spec.key);
      else next.set(spec.key, value);
      return next;
    });
  }

  function reset() {
    setStaged(new Map());
    for (const layerId of lighting.keys()) onLighting(layerId, undefined);
    setProblem(null);
  }

  async function apply() {
    if (!canApply || ops === null) return;
    setApplying(true);
    setProblem(null);
    try {
      await applyChange(token, layoutRef, { baseRevisionId: revisionId, ops, summary: `Settings: ${summary}`.slice(0, 200) });
      setStaged(new Map());
      await onApplied(`Settings: ${summary}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code?.startsWith("stale")) onStale();
      else if (error instanceof ApiError) {
        if (error.validation !== undefined) check.show(error.validation);
        setProblem(error.validation === undefined ? error.message : "This change has problems, listed below. Nothing was saved.");
      } else setProblem("The change could not be applied.");
    } finally {
      setApplying(false);
    }
  }

  const keptFor = (spec: OptionSpec) => change?.keptOwn.filter((k) => k.label === spec.label).map((k) => k.profile) ?? [];
  const blockedBy = (spec: OptionSpec): string | null => {
    const need = spec.needs === undefined ? undefined : specs.find((s) => s.key === spec.needs);
    return need !== undefined && valueOf(need) !== true ? `Turn on ${need.label} first; this does nothing without it.` : null;
  };

  return (
    <section className="settings-pane" aria-label="Settings">
      <SheetHead title="Settings" lead="For the whole keyboard. One key's timing is tuned from that key's card." closeLabel="Close the settings" onClose={onClose} />
      <div className="settings-search">
        <Search size={14} aria-hidden="true" />
        <label htmlFor={search} className="sr-only">Filter the settings</label>
        <input id={search} type="search" placeholder="Filter, such as caps or combo" value={filter} onChange={(event) => setFilter(event.target.value)} />
      </div>
      <div className="settings-body">
        {colourways === undefined || !showColourway ? null : (
          <ColourwaySetting boardName={props.boardName} colourways={colourways} value={props.colourway} onChange={props.onColourway} />
        )}
        {GROUPS.map((group) => {
          const rows = shown.filter((spec) => spec.group === group);
          if (rows.length === 0) return null;
          return (
            <section key={group} className="settings-group" aria-label={group}>
              <h3>{group}</h3>
              {rows.map((spec) => {
                const value = valueOf(spec);
                return (
                  <SettingRow
                    key={spec.key}
                    spec={spec}
                    value={value}
                    baseline={baselineOf(spec, layout, board)}
                    blockedBy={blockedBy(spec)}
                    changed={value !== baselineOf(spec, layout, board)}
                    staged={staged.has(spec.key)}
                    advanced={advanced}
                    keptOwn={staged.has(spec.key) ? keptFor(spec) : []}
                    sourceText={sourceText(spec, layout)}
                    onChange={(next) => stage(spec, next)}
                  />
                );
              })}
            </section>
          );
        })}
        {props.offer}
        {showLighting ? (
          <LightingSection layout={layout} draft={lighting} onChange={onLighting} currentLayerId={props.currentLayerId} onShowLayer={props.onShowLayer} />
        ) : null}
        {shown.length === 0 && !showLighting && !showColourway && others.length === 0 ? <p className="muted settings-empty">Nothing matches &ldquo;{filter}&rdquo;.</p> : null}
        <OtherSettings layout={layout} settings={others} />
      </div>
      {/* Apply appears only once something changed, and says the change in words (23#shared-patterns). */}
      {ops === null ? null : (
        <footer className="settings-foot">
          <p className="settings-summary" aria-live="polite">{problem ?? summary}</p>
          <Validation layout={layout} idleNote="" state={check.state} onRecheck={check.recheck} />
          <div className="settings-actions">
            <button type="button" className="sheet-action" disabled={applying} onClick={reset}>Undo these</button>
            <button type="button" className="bar-apply" disabled={!canApply} onClick={() => void apply()}>
              {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
              {applying ? "Applying" : "Apply"}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

// Everything the layout sets that the page has no control for, so nothing is hidden: the other options it writes, and the
// code and build files it keeps as written (D-103).
function OtherSettings({ layout, settings }: { layout: Layout; settings: Layout["settings"] }) {
  const kept = layout.passthrough.filter((p) => p.anchor !== "file" || p.file !== "rules.mk");
  const rules = (layout.passthrough.find((p) => p.file === "rules.mk")?.source ?? "")
    .split("\n")
    .flatMap((line) => {
      const m = /^\s*([A-Z0-9_]+)\s*[:?]?=\s*(.*?)\s*$/.exec(line);
      return m ? [{ key: m[1] as string, value: m[2] as string }] : [];
    });
  if (settings.length === 0 && kept.length === 0 && rules.length === 0) return null;
  return (
    <details className="settings-other">
      <summary>Also in this layout, read only</summary>
      <p className="muted">These are written as they came in. Ask the chat to change one, or leave them.</p>
      {settings.length === 0 ? null : (
        <dl>
          {settings.map((s) => (
            <div key={s.key}><dt>{s.key}</dt><dd>{typeof s.value === "boolean" ? (s.value ? "on" : "off") : String(s.value)}</dd></div>
          ))}
        </dl>
      )}
      {rules.length === 0 ? null : (
        <>
          <h4>Build switches (rules.mk)</h4>
          <dl>{rules.map((r, i) => <div key={`${r.key}${i}`}><dt>{r.key}</dt><dd>{r.value}</dd></div>)}</dl>
        </>
      )}
      {kept.length === 0 ? null : (
        <>
          <h4>Code kept as written</h4>
          <ul>{kept.map((p) => <li key={`${p.file}:${p.anchor}`}>{p.file}: {p.anchor}</li>)}</ul>
        </>
      )}
    </details>
  );
}
