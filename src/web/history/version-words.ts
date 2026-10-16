// How History says a version (D-315): its name, and when it was on the keyboard and for how long, in the words the comps use
// ("Since Monday 09:12", "On 3–9 Oct, for 6 days").
import type { VersionHistoryResponse } from "../../api/configs.ts";
import { formatWhen } from "./words.ts";

export type VersionView = VersionHistoryResponse["versions"][number]["version"];

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "40 minutes", "14 hours", "1 day", "6 days": how long a version was on, rounded to what a person would say. */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** "15 Oct", "3–9 Oct", "28 Sept – 3 Oct": the days a version was on the keyboard. */
export function dayRange(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to);
  const sameDay = a.toDateString() === b.toDateString();
  if (sameDay) return dayMonth.format(from);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return sameMonth ? `${day.format(from)}–${dayMonth.format(to)}` : `${dayMonth.format(from)} – ${dayMonth.format(to)}`;
}

/** "Today 10:20" reads "today 10:20" mid-sentence; weekdays and dates keep their capital. */
const lower = (when: string) => when.replace(/^(Today|Yesterday|Just now)/, (w) => w.toLowerCase());

/** The line under a version's name: when it went on and for how long, or that it was only named. */
export function versionWhen(v: Pick<VersionView, "putOnAt" | "endedAt" | "current" | "createdAt">, now: number): string {
  if (v.putOnAt === null) return `Named, never on the keyboard · ${lower(formatWhen(v.createdAt, now))}`;
  const when = lower(formatWhen(v.putOnAt, now));
  if (v.endedAt === null) return v.current ? `Since ${when}` : `Put on ${when}`;
  const span = dayRange(v.putOnAt, v.endedAt);
  const sameDay = new Date(v.putOnAt).toDateString() === new Date(v.endedAt).toDateString();
  return `On ${span}${sameDay ? ` ${time.format(v.putOnAt)}` : ""}, for ${duration(v.endedAt - v.putOnAt)}`;
}

export const versionTitle = (v: Pick<VersionView, "name">): string => v.name ?? "Unnamed";

/** "1 change", "4 changes". */
export const changes = (n: number): string => `${n} ${n === 1 ? "change" : "changes"}`;
