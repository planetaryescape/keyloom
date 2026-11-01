import { useState } from "react";
import type { ReviewActivity } from "../../api/review.ts";
import { REVIEW_ACTIVITIES, REVIEW_ACTIVITY_LABELS, reviewTaskLabel, type ReviewWorkload, type ReviewWorkloadComparison } from "../../layout/review-workload.ts";

export function ActivityChoices({ value, onChange, disabled = false }: { value: readonly ReviewActivity[]; onChange: (value: ReviewActivity[]) => void; disabled?: boolean }) {
  return <fieldset className="br-activities" disabled={disabled}>
    <legend>What will you use this board for?</legend>
    <div>{REVIEW_ACTIVITIES.map((id) => <label key={id}>
      <input type="checkbox" checked={value.includes(id)} onChange={(e) => onChange(e.target.checked ? [...value, id] : value.filter((v) => v !== id))} />
      {REVIEW_ACTIVITY_LABELS[id]}
    </label>)}</div>
  </fieldset>;
}

export function WorkloadTests({ activities, evidence, busy, onRun }: { activities: ReviewActivity[]; evidence: ReviewWorkload | undefined; busy: boolean; onRun: (activities: ReviewActivity[]) => void }) {
  const [selected, setSelected] = useState(activities);
  const choices = <>
    <ActivityChoices value={selected} onChange={setSelected} disabled={busy} />
    <p>Test short US-ANSI samples, then check suggestions against the same tasks. Uses Docker, may download firmware, and can take several minutes. Never types on or flashes your keyboard.</p>
    <div className="br-actions br-actions-start">
      <button type="button" className="sheet-action" disabled={busy || selected.length === 0} onClick={() => onRun(selected)}>Test and review</button>
      {activities.length ? <button type="button" className="sheet-action" disabled={busy} onClick={() => { setSelected([]); onRun([]); }}>Turn off tests</button> : null}
    </div>
  </>;
  return <section className="br-workloads" aria-label="Activity tests">
    {activities.length ? <details className="br-test-results"><summary>Activity tests · {activities.map((id) => REVIEW_ACTIVITY_LABELS[id]).join(", ")}</summary>{choices}</details> : choices}
    {evidence ? <BaselineResults evidence={evidence} /> : <p>{activities.length ? "Selected activities will be tested when this config is reviewed." : "No activities assumed. Choose the samples that matter to you."}</p>}
    <p>These are selected routes, not a whole-layout score or a prediction of speed or comfort.</p>
  </section>;
}

function BaselineResults({ evidence }: { evidence: ReviewWorkload }) {
  const verified = evidence.baseline.filter((task) => task.status === "verified").length;
  const progress = evidence.status === "pending" || evidence.status === "running"
    ? "Testing this version…"
    : evidence.baseline.length ? `${verified} of ${evidence.baseline.length} tasks verified` : "Tasks have not been verified.";
  return <div className="br-test-results" aria-live="polite">
    <p>{progress}</p>
    {evidence.reason ? <p>{evidence.reason}</p> : null}
    {evidence.baseline.length ? <details><summary>Baseline results</summary><ul>{evidence.baseline.map((task) => <li key={task.id}>
      <b>{reviewTaskLabel(task.id)}</b>: {task.status === "verified" ? `${task.physicalKeydowns} presses · peak ${task.maxSimultaneousKeys} keys` : task.status.replaceAll("-", " ")}
    </li>)}</ul></details> : null}
  </div>;
}

export function SuggestionTestResults({ baseline, result }: { baseline: ReviewWorkload["baseline"]; result: ReviewWorkloadComparison | undefined }) {
  if (!result || result.tasks.length === 0) return null;
  return <details className="br-test-results"><summary>Test results · current → suggested</summary><ul>
    {baseline.map((before) => {
      const after = result.tasks.find((t) => t.id === before.id);
      return <li key={before.id}><b>{reviewTaskLabel(before.id)}</b>: {before.status === "verified" && after?.status === "verified"
        ? `${before.physicalKeydowns} → ${after.physicalKeydowns} presses · peak ${before.maxSimultaneousKeys} → ${after.maxSimultaneousKeys} keys`
        : `${before.status.replaceAll("-", " ")} → ${after?.status.replaceAll("-", " ") ?? "not tested"}`}</li>;
    })}
  </ul></details>;
}
