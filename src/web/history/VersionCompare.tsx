import { ArrowLeft, ArrowRight, Copy, Keyboard, LoaderCircle, Undo2, X } from "lucide-react";
import type { CompareResponse } from "../../api/configs.ts";
import type { Layout } from "../../layout/schema.ts";
import { keyWords } from "./compare-words.ts";
import { MiniCap } from "../shell/Sheet.tsx";
import type { Milestone } from "./HistoryPanel.tsx";
import { versionTitle, versionWhen } from "./version-words.ts";
import "./history.css";

export type Comparing = { milestone: Milestone } & ({ status: "loading" } | { status: "error"; message: string } | { status: "ready"; compare: CompareResponse });

type Diff = CompareResponse["diff"];

/** "TAPPING_TERM" is "Tapping term": a setting's key as a person reads it. */
const settingName = (key: string) => key.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const value = (v: string | number | boolean | null) => (v === null ? "not set" : v === true ? "on" : v === false ? "off" : String(v));

/** "Tap dance 0" stays as it is; "Home-row mods" becomes "Timing Home-row mods": the kind is said once. */
const called = (what: string, name: string) => (name.toLowerCase().startsWith(what.toLowerCase()) ? name : `${what} ${name}`);

/** The changes that aren't keys, one line each, in the panel's words; empty when only keys differ. */
export function otherChanges(diff: Diff, layerName: (id: string) => string = (id) => id): string[] {
  const out: string[] = [];
  for (const s of diff.settings) out.push(`${settingName(s.key)}: ${value(s.before)} then, ${value(s.after)} now`);
  for (const l of diff.layersAdded) out.push(`${called("Layer", l.name)} added since`);
  for (const l of diff.layersRemoved) out.push(`${called("Layer", l.name)} removed since`);
  for (const l of diff.layersRenamed) out.push(`${called("Layer", l.from)} renamed to ${l.to}`);
  if (diff.layersReordered) out.push("The layers were reordered");
  const named = (what: string, c: Diff["macros"]) => {
    for (const n of c.added) out.push(`${called(what, n)} added since`);
    for (const n of c.removed) out.push(`${called(what, n)} removed since`);
    for (const n of c.changed) out.push(`${called(what, n)} changed`);
  };
  named("Macro", diff.macros);
  named("Tap dance", diff.tapDances);
  named("Combo", diff.combos);
  named("Conditional layer", diff.conditionalLayers);
  named("Timing", diff.holdTapProfiles);
  if (diff.lighting.length > 0) out.push(`Lighting changed on ${diff.lighting.map(layerName).join(", ")}`);
  if (diff.encoderTurns.length > 0) out.push(`Encoder turns changed on ${diff.encoderTurns.map(layerName).join(", ")}`);
  if (diff.passthrough) out.push("Firmware code passed through as-is changed");
  return out;
}

// One version against now (v3, D-315): the keys that would change if BK went back are marked on the board in the proposal's amber,
// each with what it was; here they are listed per layer, then everything else, then the three ways to use the version.
export function VersionCompare({ comparing, layout, boardName, layerId, layerName, onBack, onClose, onShowLayer, onGoBack, onPutOn, onNewConfig, blockedReason }: {
  comparing: Comparing;
  /** The layout now, for saying what each key does now. */
  layout: Pick<Layout, "layers" | "macros" | "tapDances" | "passthrough">;
  boardName: string;
  /** The layer on screen, whose keys carry the marks. */
  layerId: string;
  /** A layer's name from its ID, for the lines that only carry IDs. */
  layerName: (id: string) => string;
  onBack: () => void;
  onClose: () => void;
  onShowLayer: (layerId: string) => void;
  onGoBack: () => void;
  onPutOn: () => void;
  onNewConfig: () => void;
  blockedReason: string | null;
}) {
  const v = comparing.milestone.version;
  const now = Date.now();
  return (
    <section className="history-panel" aria-label={`Compare ${versionTitle(v)} with now`}>
      <header className="sheet-head">
        <div className="sheet-title">
          <button type="button" className="sheet-action history-back" onClick={onBack}><ArrowLeft size={13} aria-hidden="true" />History</button>
          <h2>{versionTitle(v)}</h2>
          <p>{versionWhen(v, now)}. Going back to it changes what's marked on the board.</p>
        </div>
        <button type="button" className="sheet-close" aria-label="Close the history" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="sheet-body">
        {comparing.status === "loading" ? (
          <p className="sheet-empty" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Comparing…</p>
        ) : comparing.status === "error" ? (
          <p className="sheet-empty" role="alert">{comparing.message}</p>
        ) : comparing.compare.diff.same ? (
          <p className="sheet-empty">Nothing differs from now.</p>
        ) : (
          <Differences compare={comparing.compare} layout={layout} layerId={layerId} layerName={layerName} onShowLayer={onShowLayer} />
        )}
      </div>
      <footer className="history-compare-foot">
        <button type="button" className="sheet-action" onClick={onNewConfig}><Copy size={13} aria-hidden="true" />New config from here</button>
        <button type="button" className="sheet-action" disabled={blockedReason !== null} onClick={onPutOn}><Keyboard size={13} aria-hidden="true" />Put on your {boardName}</button>
        <button type="button" className="bar-apply" disabled={blockedReason !== null || (comparing.status === "ready" && comparing.compare.diff.same)} onClick={onGoBack}>
          <Undo2 size={14} aria-hidden="true" />Go back to this
        </button>
      </footer>
    </section>
  );
}

function Differences({ compare, layout, layerId, layerName, onShowLayer }: {
  compare: CompareResponse;
  layout: Pick<Layout, "layers" | "macros" | "tapDances" | "passthrough">;
  layerId: string;
  layerName: (id: string) => string;
  onShowLayer: (layerId: string) => void;
}) {
  const diff = compare.diff;
  const layers = new Map<string, { name: string; keys: Diff["keys"] }>();
  for (const k of diff.keys) {
    const entry = layers.get(k.layerId) ?? { name: k.layerName, keys: [] };
    entry.keys.push(k);
    layers.set(k.layerId, entry);
  }
  const other = otherChanges(diff, layerName);
  return (
    <>
      {[...layers].map(([id, { name, keys }]) => (
        <div key={id} className="history-compare-group">
          <h3>
            {/* The marks are on the layer on screen; another layer's heading shows it. */}
            {id === layerId ? <span>{name} · {keys.length} {keys.length === 1 ? "key" : "keys"} · marked on the board</span> : (
              <button type="button" className="history-inline" onClick={() => onShowLayer(id)}>{name} · {keys.length} {keys.length === 1 ? "key" : "keys"} · show</button>
            )}
          </h3>
          <ul className="history-compare-keys">
            {keys.map((k) => {
              // Named by what the key does, then and now, with what changed (D-316); the caps alone can read "TD0 → TD0".
              const words = keyWords(k.before, compare.fromContext, k.after, layout);
              return (
                <li key={`${k.layerId}:${k.position}`}>
                  <span className="history-compare-caps">
                    <span className="history-then"><MiniCap>{k.beforeLabel || "nothing"}</MiniCap></span>
                    <ArrowRight size={12} className="revision-arrow" aria-label="now" role="img" />
                    <MiniCap>{k.afterLabel || "nothing"}</MiniCap>
                  </span>
                  <span className="history-compare-words">
                    {words.title}
                    {words.change === null ? (words.then === words.now ? null : <span className="history-compare-note"> · was {words.then}</span>) : <span className="history-compare-note"> · {words.change}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {other.length === 0 ? null : (
        <div className="history-compare-group">
          <h3><span>Everything else · {other.length}</span></h3>
          <ul className="history-compare-other">{other.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
    </>
  );
}
