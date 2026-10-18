import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import sample from "../../fixtures/web/moonlander-sample.json";
import boardData from "../../../boards/zsa/moonlander/board.json";
import geometryData from "../../../boards/zsa/moonlander/geometry.json";
import { LayoutDetailSchema, type ProposalCard } from "../../../src/api/http.ts";
import { BoardDefinitionSchema, GeometrySchema } from "../../../src/boards/schema.ts";
import { describeKey } from "../../../src/layout/describe.ts";
import type { ChangeOp } from "../../../src/layout/change.ts";
import { evaluate } from "../../../src/validation/validate.ts";
import { AgentMotionToggle } from "../../../src/web/chat/AgentWorking.tsx";
import { Composer } from "../../../src/web/chat/Composer.tsx";
import { AssistantMessage, UserMessage } from "../../../src/web/chat/Turns.tsx";
import { keyLabel } from "../../../src/web/chat/proposal-facts.ts";
import { marksOn, previewProposal } from "../../../src/web/chat/preview.ts";
import type { AssistantTurn } from "../../../src/web/chat/transcript.ts";
import type { AgentOperationView, AgentWorkStatus, AgentWorkView } from "../../../src/web/chat/work-view.ts";
import { Keyboard } from "../../../src/web/keyboard/Keyboard.tsx";
import { applyDisplayRotation } from "../../../src/web/keyboard/geometry.ts";
import { SidePanel } from "../../../src/web/shell/SidePanel.tsx";
import { sheetHeight, type SheetSize } from "../../../src/web/shell/sheet.ts";
import "../../../src/web/tokens.css";
import "../../../src/web/app.css";
import "../../../src/web/shell/shell.css";
import "../../../src/web/chat/chat.css";
import "../../../src/web/chat/command-bar.css";
import "./fixture.css";

const { document: layout } = LayoutDetailSchema.parse(sample);
const board = BoardDefinitionSchema.parse(boardData);
const geometry = GeometrySchema.parse(geometryData);
const keys = applyDisplayRotation(geometry.keys, board.display);
const layer = (() => {
  const first = layout.layers[0];
  if (first === undefined) throw new Error("The synthetic fixture needs its base layer.");
  return first;
})();
const profile = layout.holdTapProfiles[0];
if (profile === undefined) throw new Error("The synthetic fixture needs a hold profile.");
const ops: ChangeOp[] = ["K", "L"].map((code) => {
  const position = layer.bindings.findIndex((_, position) => keyLabel(layout, { layerId: layer.id, position }) === code);
  if (position < 0) throw new Error(`No ${code} in the synthetic fixture`);
  return { op: "setBinding", at: { layerId: layer.id, position }, binding: { kind: "holdTap", tap: { code }, hold: { mods: [code === "K" ? "LALT" : "LCTL"] }, profileId: profile.id } };
});
ops.push({ op: "dropFunction", function: "mod:RGUI", reason: "The synthetic request replaces K's existing Command hold." });
ops.push({ op: "dropFunction", function: "mod:RALT", reason: "The synthetic request replaces L's existing Option hold." });
const proposal: ProposalCard = {
  changeSetId: "component-fixture-preview", proposalGroup: null, title: "Two holds, same letters", explanation: "Hold K for Option. Hold L for Control. Their letters stay the same.",
  tradeoffs: { gains: [], costs: ["L no longer holds Option; K no longer holds Command."] }, decisionDraft: null, status: "proposed", validation: evaluate(board, layout, ops).result, ops,
};
if (!proposal.validation.ok) throw new Error("The synthetic preview must pass the real validator.");
const request = { kind: "user", id: "request", text: "Put Option on K and Control on L when held. Keep their letters.", selection: { layerId: layer.id, positions: ops.flatMap((op) => op.op === "setBinding" ? [op.at.position] : []) } } as const;
const statuses: readonly AgentWorkStatus[] = ["running", "waiting", "completed", "failed", "stopped", "disconnected"];
const read: AgentOperationView = { id: "read-keys", label: "Read the selected keys", target: "Moonlander · Daily · Base · K, L", status: "succeeded", durationMs: 200, summary: null };
const validate: AgentOperationView = { id: "validate", label: "Check the proposed holds", target: "2 bindings · letters preserved", status: "succeeded", durationMs: 400, summary: "The proposal passed validation." };
const save: AgentOperationView = { id: "save", label: "Prepare the proposal", target: "Moonlander · Daily · 2 holds", status: "succeeded", durationMs: 100, summary: "A proposal is prepared, not applied or verified on device." };

function Fixture() {
  const [status, setStatus] = useState<AgentWorkStatus>("running");
  const [paused, setPaused] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [draft, setDraft] = useState("");
  const [pinned, setPinned] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [size, setSize] = useState<SheetSize>("full");
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const running = status === "running";
  const ready = status === "completed" || status === "failed";
  const preview = useMemo(() => previewProposal(board, layout, proposal, layer.id), []);
  const shown = ready && pinned ? preview.layout : layout;
  const descriptions = useMemo(() => keys.map((_, position) => describeKey(shown, 0, position)), [shown]);
  const operations = running ? [read, { ...validate, status: "running" as const, durationMs: null, summary: null }]
    : status === "failed" ? [read, save, { ...validate, status: "failed" as const, summary: "The current config changed. Recheck before Apply." }]
    : status === "stopped" || status === "disconnected" ? [read, { ...validate, status: "running" as const, summary: null, durationMs: null }]
    : status === "waiting" ? [read] : [read, validate, save];
  const working: AgentWorkView = legacy ? { kind: "unavailable", status } : { kind: "observed", status, label: running ? "Checking the two holds…" : null, operations, notes: [{ id: "note", text: "I’m checking the holds without changing K and L’s tap letters." }] };
  const turn: AssistantTurn = {
    kind: "assistant", id: "answer", text: ready ? "The two holds are ready to preview. Your current config has not been applied." : "", activity: null,
    proposals: ready ? [proposal] : [], priorities: [], question: status === "waiting" ? { toolUseId: "question", question: "Keep Option on S as well?", options: [{ label: "Keep it on S", description: "Adds the new hold without removing your left-hand Option." }, { label: "Move it to K" }], allowOther: true, answer: null } : null,
    phase: running ? "streaming" : status === "failed" || status === "disconnected" ? "failed" : status === "stopped" ? "stopped" : "done",
    failure: status === "failed" || status === "disconnected" ? { code: "stream", message: status === "failed" ? "The current config changed after the preview was prepared." : "The connection dropped before the result was confirmed." } : null,
    ending: running ? null : "complete",
  };
  const chat = <section className="chat" data-variant="bar" data-presentation="panel" data-streaming={running} aria-label="Ask keyloom">
    <div className="chat-context"><p>Editing Moonlander · Daily · Base</p><AgentMotionToggle paused={paused} onChange={setPaused} /></div>
    <div className="chat-log" role="log" tabIndex={0} aria-label="Synthetic conversation">
      <UserMessage turn={{ ...request, selection: { ...request.selection, positions: [...request.selection.positions] } }} layout={layout} context="Moonlander · Daily · Base" />
      <AssistantMessage turn={turn} layout={layout} board={board} pinnedId={pinned ? proposal.changeSetId : null} onPreview={() => {}} onPin={() => setPinned((value) => !value)} onApply={async () => { throw new Error("Synthetic component fixture: Apply is not connected."); }} onRemovePriority={async () => {}} onAskAgain={() => setStatus("running")} onOpenRelease={() => {}} onRetry={() => setStatus("running")} onAnswer={() => setStatus("completed")} working={working} motionPaused={paused} compact />
    </div>
    <Composer value={draft} onChange={setDraft} onSend={() => setStatus("running")} onStop={() => setStatus("stopped")} streaming={running} selection={null} onRemoveKey={() => {}} onClearSelection={() => {}} inputRef={input} quiet={{ menu: null, onEscape: () => {}, placeholder: "Reply or ask about your keyboard" }} />
  </section>;
  const style: CSSProperties & { "--sheet-h": string } = { "--sheet-h": `${sheetHeight(size, viewport.height)}px` };
  return <>
    <header className="fixture-controls"><strong>Synthetic component fixture · no live agent</strong><label>State <select aria-label="Fixture state" value={status} onChange={(event) => { const next = statuses.find((candidate) => candidate === event.target.value); if (next !== undefined) setStatus(next); }}>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label><button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>Switch theme</button><label><input type="checkbox" checked={legacy} onChange={(event) => setLegacy(event.target.checked)} /> Legacy</label></header>
    <main className="fixture-main" style={style}>
      <section className="fixture-stage"><p>keyloom · Moonlander / Daily</p><h1>Base</h1><p className="muted">{ready ? "Preview only · not verified on your Moonlander" : "Working beside your keyboard"}</p><div className="fixture-keyboard"><Keyboard keys={keys} keycaps={board.display?.keycaps} display={board.display} hands={board.hands} fingers={board.fingers} descriptions={descriptions} layerName={layer.name} selected={selected} partners={new Set()} comboKeys={new Set()} onSelect={setSelected} onHover={() => {}} onPress={setSelected} marks={ready && pinned ? marksOn(preview, layer.id) : new Map()} half={viewport.width <= 600 ? "right" : null} /></div><p className="fixture-layer">Base &nbsp; · &nbsp; Symbols &nbsp; · &nbsp; Navigation</p></section>
      <SidePanel mode="chat" summary={null} key_={null} chat={chat} repeat={null} history={null} combo={null} library={null} settings={null} size={size} viewportHeight={viewport.height} onSize={setSize} />
    </main>
  </>;
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing fixture root");
createRoot(root).render(<Fixture />);
