import type { Build, Flash } from "../../api/http.ts";

/** m:ss, so "0:07" and "12:03". Negative or non-finite input reads as zero. */
export function formatElapsed(ms: number): string {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export type ReleaseStatus = {
  label: string;
  tone: "idle" | "busy" | "attention" | "success" | "error";
};

export function elapsedOf(job: { startedAt: number; finishedAt: number | null }, now: number): string {
  return formatElapsed((job.finishedAt ?? now) - job.startedAt);
}

/** One word or two for the header button, from the newest thing that happened to the head revision. */
export function releaseStatus(build: Build | null, flash: Flash | null, headRevisionId: string, now: number): ReleaseStatus {
  if (build === null || build.revisionId !== headRevisionId) return { label: "Build and flash", tone: "idle" };
  if (flash !== null && flash.buildId === build.id) {
    switch (flash.status) {
      case "waiting_for_bootloader": return { label: "Press reset", tone: "attention" };
      case "writing": return { label: "Flashing", tone: "busy" };
      case "succeeded": return { label: "Flashed", tone: "success" };
      case "failed": return { label: "Flash failed", tone: "error" };
    }
  }
  switch (build.status) {
    case "running": return { label: `Building ${elapsedOf(build, now)}`, tone: "busy" };
    case "succeeded": return { label: "Ready to flash", tone: "success" };
    case "failed": return { label: "Build failed", tone: "error" };
  }
}
