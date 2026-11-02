import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { ProposalCardSchema } from "../../src/api/http.ts";
import { BoardDefinitionSchema } from "../../src/boards/schema.ts";
import { LayoutSchema } from "../../src/layout/schema.ts";
import { ProposalCard } from "../../src/web/chat/ProposalCard.tsx";
import "../../src/web/tokens.css";

const Snapshot = z.object({ proposal: ProposalCardSchema, layout: LayoutSchema });
const Snapshots = z.object({ board: BoardDefinitionSchema, applied: Snapshot, missing: Snapshot, confirmation: z.object({ proposal: ProposalCardSchema, before: LayoutSchema, after: LayoutSchema }) });
function Fixture() {
  const [snapshots, setSnapshots] = useState<z.infer<typeof Snapshots> | null>(null);
  const [scenario, setScenario] = useState<"applied" | "missing" | "confirmation">("applied");
  const [compact, setCompact] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [attempts, setAttempts] = useState(0);
  useEffect(() => { void fetch("/snapshots").then((response) => response.json()).then((data) => setSnapshots(Snapshots.parse(data))); }, []);
  if (!snapshots) return <p>Loading synthetic snapshots</p>;
  const source = scenario === "confirmation" ? { proposal: snapshots.confirmation.proposal, layout: advanced ? snapshots.confirmation.after : snapshots.confirmation.before } : snapshots[scenario];
  return <section style={{ maxWidth: 600, margin: "24px auto" }}>
    <nav aria-label="Synthetic scenarios">
      <button onClick={() => { setScenario("applied"); setAdvanced(false); }}>Applied history</button>
      <button onClick={() => { setScenario("missing"); setAdvanced(false); }}>Missing layer</button>
      <button onClick={() => { setScenario("confirmation"); setAdvanced(false); }}>Native confirmation</button>
      <button onClick={() => setCompact((value) => !value)}>{compact ? "Use full card" : "Use compact card"}</button>
      <button onClick={() => setAdvanced(true)}>Advance synthetic head</button>
    </nav>
    <p role="status">Apply handler calls: <output>{attempts}</output></p>
    <ProposalCard key={`${scenario}:${compact}`} proposal={source.proposal} layout={source.layout} board={snapshots.board} compact={compact} pinned={false} onPreview={() => {}} onPin={() => {}} onApply={async () => setAttempts((count) => count + 1)} onAskAgain={() => {}} onOpenRelease={() => {}} />
  </section>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
