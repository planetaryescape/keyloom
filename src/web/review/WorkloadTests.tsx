import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { ReviewActivity } from "../../api/review.ts";
import type { Firmware } from "../../layout/schema.ts";
import { REVIEW_ACTIVITIES, REVIEW_ACTIVITY_LABELS, reviewTaskLabel, type ReviewWorkload, type ReviewWorkloadComparison } from "../../layout/review-workload.ts";
import { DockerCallout } from "../release/DockerCallout.tsx";
import { dockerView, recheckDocker } from "../release/release-words.ts";
import { type Docker, useDocker, useDockerRecheck } from "../release/useDocker.ts";
import { type Install, useInstall } from "../release/useInstall.ts";

/** Whether the last test run stopped for Docker, from the server's code rather than its sentence (R1-12). */
export const testsNeedDocker = (evidence: ReviewWorkload | undefined): boolean => evidence?.status === "unavailable" && evidence.reasonCode === "docker";

/** The release dialog's Docker callout, with Test again once Docker answers: the same Install, Start or Open as a build gets. */
function TestsNeedDocker({ token, busy, onRetry }: { token: string; busy: boolean; onRetry: () => void }) {
  const docker = useDocker(token);
  const install = useInstall(token, "docker", docker.refresh);
  return <TestsNeedDockerView docker={docker} install={install} busy={busy} onRetry={onRetry} />;
}

/** Split from its hooks so a test can render each state. A readiness request that failed keeps asking and offers Check again. */
export function TestsNeedDockerView({ docker, install, busy, onRetry }: { docker: Docker; install: Install; busy: boolean; onRetry: () => void }) {
  const view = dockerView(docker.readiness, docker.starting, docker.problem, install.state, docker.lastAction);
  useDockerRecheck(docker, recheckDocker(view) || docker.unanswered);
  const ready = docker.readiness?.ok === true;
  return <div className="br-test-results">
    {/* Docker installed from here says it is running in its own callout, so this line would only repeat it (R3-14). */}
    {view.kind === "installed" ? null : <p>{ready ? "Docker is ready now." : "Activity tests run in Docker, and Docker isn't ready on this computer."}</p>}
    {docker.unanswered ? <div className="callout callout-warning" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div className="callout-body">
        <p>keyloom couldn't ask whether Docker is ready. It asks again every few seconds.</p>
        <div className="callout-actions"><button type="button" className="button" onClick={docker.refresh}>Check again</button></div>
      </div>
    </div> : null}
    <DockerCallout view={view} docker={docker} install={install} readyNext="Test again to see the results." />
    {ready ? <div className="br-actions br-actions-start"><button type="button" className="sheet-action" disabled={busy} onClick={onRetry}>Test again</button></div> : null}
  </div>;
}

export function ActivityChoices({ value, onChange, disabled = false }: { value: readonly ReviewActivity[]; onChange: (value: ReviewActivity[]) => void; disabled?: boolean }) {
  return <fieldset className="br-activities" disabled={disabled}>
    <legend>What will you use this board for?</legend>
    <div>{REVIEW_ACTIVITIES.map((id) => <label key={id}>
      <input type="checkbox" checked={value.includes(id)} onChange={(e) => onChange(e.target.checked ? [...value, id] : value.filter((v) => v !== id))} />
      {REVIEW_ACTIVITY_LABELS[id]}
    </label>)}</div>
  </fieldset>;
}

export function WorkloadTests({ token, firmware, activities, evidence, busy, onRun }: { token: string; firmware: Firmware; activities: ReviewActivity[]; evidence: ReviewWorkload | undefined; busy: boolean; onRun: (activities: ReviewActivity[]) => void }) {
  const [selected, setSelected] = useState(activities);
  // kanata has no firmware to replay a test on, so the choice would always end "not available" (R1-13).
  if (firmware === "kanata") return null;
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
    {testsNeedDocker(evidence) ? <TestsNeedDocker token={token} busy={busy} onRetry={() => onRun(activities)} />
      : evidence ? <BaselineResults evidence={evidence} active={busy} /> : <p>{activities.length ? "Selected activities will be tested when this config is reviewed." : "No activities assumed. Choose the samples that matter to you."}</p>}
    <p>These are selected routes, not a whole-layout score or a prediction of speed or comfort.</p>
  </section>;
}

function BaselineResults({ evidence, active }: { evidence: ReviewWorkload; active: boolean }) {
  const verified = evidence.baseline.filter((task) => task.status === "verified").length;
  const progress = evidence.status === "pending" || evidence.status === "running"
    ? active ? "Testing this version…" : "Activity testing is not running. Run the review to test this version."
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
