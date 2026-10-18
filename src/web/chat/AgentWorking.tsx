import { Check, ChevronRight, CircleAlert, Clock3, Pause, Square } from "lucide-react";
import { useId, useState } from "react";
import { observedDuration, operationStatusWords, preserveWorkFocus, projectWork, workDetailsOpen, type AgentOperationView, type AgentWorkStatus, type AgentWorkView, type OperationStatus, type WorkDisclosureChoice } from "./work-view.ts";
import "./agent-work.css";

export interface AgentWorkingProps {
  view: AgentWorkView;
  /** An app preference; this does not pause execution. Reduced motion also disables shimmer. */
  motionPaused?: boolean;
}

const STATUS_WORDS = {
  running: "Working…",
  waiting: "Needs your answer",
  completed: "Reply complete · some steps need attention",
  failed: "Work stopped with a problem",
  stopped: "Stopped",
  disconnected: "Connection lost · outcome not confirmed",
} satisfies Record<AgentWorkStatus, string>;

export function AgentWorking({ view, motionPaused = false }: AgentWorkingProps) {
  if (view.kind === "unavailable") {
    return (
      <div className="agent-working" data-motion-paused={motionPaused}>
        {view.status === "running" || view.status === "waiting" ? <WorkStatus status={view.status} /> : null}
        <p className="agent-history-unavailable">Working details unavailable for this conversation.</p>
      </div>
    );
  }
  // Keep the disclosure's local choice when operations or message chunks arrive.
  return <ObservedWorking view={view} motionPaused={motionPaused} />;
}

function ObservedWorking({ view, motionPaused }: { view: Extract<AgentWorkView, { kind: "observed" }>; motionPaused: boolean }) {
  const work = projectWork(view);
  const [choice, setChoice] = useState<WorkDisclosureChoice>("automatic");
  const [focusInside, setFocusInside] = useState(false);
  const panelId = useId();
  const open = workDetailsOpen(choice, work.canFold, focusInside);

  const hasDetails = work.routine.length > 0 || work.notes.length > 0;
  return (
    <div className="agent-working" data-motion-paused={motionPaused}>
      {view.status === "completed" && work.attention.length === 0 ? null : <WorkStatus status={view.status} label={view.label} />}
      {view.warning ? <p className="agent-work-incomplete">{view.warning}</p> : null}
      {!view.detailsTruncated ? null : <p className="agent-work-incomplete">Some working details were not retained. The final reply and saved proposals remain separate.</p>}
      {work.omitted === 0 && work.omittedNotes === 0 ? null : (
        <p className="agent-work-incomplete">Earlier working details are not shown ({work.omitted} steps, {work.omittedNotes} notes). Their outcomes are not confirmed here.</p>
      )}
      {/* Running, failed, cancelled and uncertain calls never disappear inside routine working. */}
      <OperationList operations={work.attention} />
      {!hasDetails ? null : (
        <div
          className="agent-work-disclosure"
          onFocusCapture={() => { if (open) setFocusInside(true); }}
          onBlurCapture={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
              // If completion arrived during reading, leaving focus must not trigger a delayed fold.
              setChoice((current) => preserveWorkFocus(current, work.canFold, focusInside));
              setFocusInside(false);
            }
          }}
        >
          <button
            type="button"
            className="agent-work-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setChoice(open ? "closed" : "open")}
          >
            <ChevronRight size={14} aria-hidden="true" />
            {work.routine.length === 0 ? "Working notes" : `${work.routine.length} completed ${work.routine.length === 1 ? "step" : "steps"}`}
            {work.notes.length === 0 || work.routine.length === 0 ? null : " · working notes"}
          </button>
          <div id={panelId} className="agent-work-details" hidden={!open}>
            {work.notes.map((note) => <p className="agent-working-note" key={note.id}>{note.text}</p>)}
            <OperationList operations={work.routine} />
          </div>
        </div>
      )}
    </div>
  );
}

function WorkStatus({ status, label }: { status: AgentWorkStatus; label?: string | null }) {
  const active = status === "running";
  return (
    <p className="agent-work-status" data-active={active} role="status">
      <StatusIcon status={active ? "running" : status === "failed" || status === "disconnected" ? "unknown" : "cancelled"} />
      <span className="agent-work-label">{active ? label?.trim().slice(0, 160) || STATUS_WORDS[status] : STATUS_WORDS[status]}</span>
    </p>
  );
}

function StatusIcon({ status }: { status: OperationStatus }) {
  const Icon = status === "succeeded" ? Check : status === "running" ? Clock3 : status === "cancelled" ? Square : CircleAlert;
  return <Icon size={14} aria-hidden="true" />;
}

function OperationList({ operations }: { operations: readonly AgentOperationView[] }) {
  if (operations.length === 0) return null;
  return (
    <ul className="agent-operations" aria-label="Agent operations">
      {operations.map((operation) => {
        const duration = observedDuration(operation.durationMs);
        return (
          <li key={operation.id} className="agent-operation" data-state={operation.status}>
            <StatusIcon status={operation.status} />
            <div className="agent-operation-body">
              <p className="agent-operation-label">{operation.label}</p>
              {operation.target === null ? null : <p className="agent-operation-target">{operation.target}</p>}
              {operation.summary === null ? null : <p className="agent-operation-result">{operation.summary}</p>}
            </div>
            <p className="agent-operation-state">{operationStatusWords(operation.status)}{duration === null ? null : <span>{duration}</span>}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function AgentMotionToggle({ paused, onChange }: { paused: boolean; onChange: (paused: boolean) => void }) {
  return <button type="button" className="agent-motion-toggle" aria-pressed={paused} onClick={() => onChange(!paused)}><Pause size={14} aria-hidden="true" />{paused ? "Resume animation" : "Pause animation"}</button>;
}
