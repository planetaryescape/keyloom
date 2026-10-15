// The header keyloom puts on keyloom.kbd, and the marker a running kanata reports (21#apply-verify-and-safety).
// The header names the layout and revision and carries a hash of everything after it, so keyloom can tell its own
// file from one BK wrote or edited by hand, and refuses to overwrite the latter without being asked.
import { createHash } from "node:crypto";

const HEAD = ";; keyloom generated this file. Edits are overwritten the next time you Apply; change the layout in keyloom instead.";
export const BODY_START = ";; ---- body ----";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The virtual key a running kanata lists in `RequestFakeKeyNames`, so keyloom can see which revision it runs. */
export const markerName = (revisionId: string): string => `keyloom-${revisionId}`;

export function withHeader(body: string, layoutId: string, revisionId: string): string {
  return `${HEAD}\n;; keyloom-layout: ${layoutId}\n;; keyloom-revision: ${revisionId}\n;; keyloom-body-sha256: ${sha256(body)}\n${BODY_START}\n${body}`;
}

export type Header = { layoutId: string; revisionId: string; bodySha256: string; /** The body still hashes to the header's value: nobody edited the file. */ intact: boolean };

/** The header of a file keyloom wrote, or undefined for any other file. */
export function readHeader(text: string): Header | undefined {
  const m = /^;; keyloom generated this file[^\n]*\n;; keyloom-layout: (\S+)\n;; keyloom-revision: (\S+)\n;; keyloom-body-sha256: ([0-9a-f]{64})\n;; ---- body ----\n/.exec(text);
  if (!m) return undefined;
  const body = text.slice(m[0].length);
  return { layoutId: m[1] as string, revisionId: m[2] as string, bodySha256: m[3] as string, intact: sha256(body) === m[3] };
}
