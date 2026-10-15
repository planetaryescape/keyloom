import type { RevisionEntry } from "../../api/http.ts";

// The panel says "Chat" for what the data calls an agent change, because that is the place BK made it (18#words).
const SOURCES: Record<RevisionEntry["origin"], string> = { editor: "Editor", agent: "Chat", import: "Import", undo: "Undo" };

export const sourceLabel = (origin: RevisionEntry["origin"]): string => SOURCES[origin];

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const date = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dateYear = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "Today 18:32", "Yesterday 18:32", "Tuesday 18:32" within the last week, then the date. Calendar days, not 24-hour spans, so "last Tuesday" means Tuesday. */
export function formatWhen(then: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  const time = clock.format(then);
  if (now - then < 60_000 && now >= then) return "Just now";
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${weekday.format(then)} ${time}`;
  const sameYear = new Date(then).getFullYear() === new Date(now).getFullYear();
  return `${(sameYear ? date : dateYear).format(then)} ${time}`;
}
