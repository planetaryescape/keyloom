import { useState, type ReactNode } from "react";
import type { RevisionInfo } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import { ReleaseDialog } from "./ReleaseDialog.tsx";
import { releaseStatus, type ReleaseStatus } from "./status.ts";
import { useNow } from "./useNow.ts";
import { useRelease } from "./useRelease.ts";

/** What the page needs of Build and flash: the header button's words and a way to open the dialog. */
export type ReleaseHandle = { status: ReleaseStatus; open: (revision?: { id: string; summary: string }) => void };

type AutoSync = { on: boolean; paused: boolean; onPause: () => void; onResume?: () => void } | null;

/**
 * Build and flash for one layout: its builds, its flashes, the Docker it needs and the dialog. A board that is never built (the
 * MacBook keyboard, D-501) doesn't mount this, so it never asks for Docker's readiness or offers the dialog.
 */
export function ReleaseHost({ token, layoutId, head, boardName, boardRevisions, autoSync, children }: {
  token: string;
  layoutId: string;
  head: Pick<RevisionInfo, "id" | "summary">;
  boardName: string;
  boardRevisions: BoardDefinition["revisions"];
  autoSync: AutoSync;
  children: (release: ReleaseHandle, dialog: ReactNode) => ReactNode;
}) {
  const release = useRelease(token, layoutId);
  const [open, setOpen] = useState(false);
  // History's "Flash this revision" builds an earlier revision instead of the head; null is the head.
  const [target, setTarget] = useState<{ id: string; summary: string } | null>(null);
  const releasing = release.build?.status === "running" || release.flash?.status === "waiting_for_bootloader" || release.flash?.status === "writing";
  const now = useNow(releasing);
  const status = releaseStatus(release.build, release.flash, head.id, now);
  const handle: ReleaseHandle = {
    status,
    open: (revision) => {
      setTarget(revision === undefined || revision.id === head.id ? null : revision);
      setOpen(true);
    },
  };
  const dialog = (
    <ReleaseDialog
      open={open}
      onClose={() => setOpen(false)}
      release={release}
      head={target ?? head}
      earlierRevision={target !== null}
      autoSync={autoSync}
      boardName={boardName}
      boardRevisions={boardRevisions}
      status={status}
      now={now}
    />
  );
  return <>{children(handle, dialog)}</>;
}
