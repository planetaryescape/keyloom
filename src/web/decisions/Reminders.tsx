import { History } from "lucide-react";
import type { Layout } from "../../layout/schema.ts";
import type { DecisionReminder } from "../../validation/result.ts";
import { slotName } from "./decision-text.ts";
import "./decisions.css";

const STATUS_NOTE: Record<DecisionReminder["status"], string> = {
  hypothesis: "You haven't tested yet whether it helped.",
  tried_helpful: "You tried it and it helped.",
};

// The reason stored when BK set these keys up, quoted beside the change that touches them. It never
// blocks (D-023): it is here so the change is made knowing why the old one was.
export function Reminders({ reminders, layout }: { reminders: readonly DecisionReminder[]; layout: Layout }) {
  if (reminders.length === 0) return null;
  return (
    <ul className="reminders" aria-label="Reasons you set these keys up">
      {reminders.map((r) => (
        <li key={r.decisionId} className="reminder">
          <History size={16} aria-hidden="true" />
          <div className="reminder-body">
            <p className="reminder-lead">
              <span className="sr-only">Reminder: </span>
              {r.slots.map((s) => slotName(layout, s)).join("; ")}
            </p>
            <p>You set this up for &ldquo;{r.goal}&rdquo;: {r.reason}</p>
            <p className="reminder-status">{STATUS_NOTE[r.status]}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
