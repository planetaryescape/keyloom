// Whether a keyloom server that is already running can serve a client, and the words for saying why not (D-454, D-325: the CLI words it,
// the desktop shell only displays it). Pure, so every case is a table test.
import type { RunningRecord } from "./running-server.ts";

// The CLI may import the server but not api/ (the module table), so it takes the protocol number from here.
export { DESKTOP_PROTOCOL } from "../api/desktop-protocol.ts";

export type Identity = { version: string; protocol: number };

export type Verdict =
  | { compatible: true }
  | { compatible: false; words: string; /** The label for replacing it, or null when replacing would downgrade it. */ replaceLabel: string | null };

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** -1 when `a` is older than `b`, 1 when newer, 0 when equal, undefined when either is not a version (a clone's or hand-edited record). */
export function compareVersions(a: string | undefined, b: string): -1 | 0 | 1 | undefined {
  if (a === undefined || !SEMVER.test(a) || !SEMVER.test(b)) return undefined;
  try {
    return Bun.semver.order(a, b);
  } catch {
    return undefined;
  }
}

export const REPLACE_LABEL = "Use this app's keyloom";

export function assessServer(live: Pick<RunningRecord, "version" | "protocol">, mine: Identity, dir: string): Verdict {
  if (live.protocol === mine.protocol) return { compatible: true };
  const order = compareVersions(live.version, mine.version);
  // Unknown counts as older: a record without a version was written before keyloom checked, so it is an older keyloom. Replacing an
  // older server is an upgrade; replacing a newer one would be a downgrade, so that is never offered.
  if (order === undefined || order < 0) {
    const was = live.version === undefined ? "an older keyloom that predates version checks" : order === undefined ? `keyloom ${JSON.stringify(live.version)}, an unreadable version` : `keyloom ${live.version}, older than this ${mine.version}`;
    return { compatible: false, replaceLabel: REPLACE_LABEL, words: `${dir} is already being served by ${was}, which may not work with this one.` };
  }
  if (order === 0) return { compatible: false, replaceLabel: null, words: `${dir} is already being served by keyloom ${live.version}, the same version as this one but built for a different desktop protocol. Reinstall the app and keyloom from one release.` };
  return {
    compatible: false,
    replaceLabel: null,
    words: `${dir} is already being served by keyloom ${live.version}, which is newer than this ${mine.version}. Update this keyloom (or the app) instead; replacing the server would downgrade it.`,
  };
}

/** The `--replace` rule: refuse only a server that is certainly newer. */
export const wouldDowngrade = (live: Pick<RunningRecord, "version">, mine: Identity): boolean => {
  const order = compareVersions(live.version, mine.version);
  return order !== undefined && order > 0;
};
