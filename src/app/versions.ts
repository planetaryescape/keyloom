// Use cases for versions (25, D-301): a layout's history as milestones, naming, going back to one, and comparing with the head.
import { type LayoutDiff, diffLayouts } from "../layout/diff.ts";
import type { Binding, Layout } from "../layout/schema.ts";
import { deepEqual } from "../layout/equal.ts";
import { bindingLabel } from "../layout/render-grid.ts";
import { getBoardConfig } from "../persistence/configs.ts";
import { type LayoutRow, type RevisionRow, findLayoutRow, findRevision, revisionChain } from "../persistence/layouts.ts";
import { transact } from "../persistence/transaction.ts";
import { type VersionRow, findVersion, listVersionRows, nameVersion as storeName } from "../persistence/versions.ts";
import { undo } from "./changes.ts";
import type { App } from "./context.ts";
import { NotFoundError, UsageError } from "./errors.ts";

export type RevisionBrief = { id: string; origin: RevisionRow["origin"]; summary: string; createdAt: number };

export type VersionView = {
  id: string;
  revisionId: string;
  name: string | null;
  /** When it went on the keyboard; null for a revision that was named without being put on. */
  putOnAt: number | null;
  /** When another version replaced it; null while it is the one on the keyboard, or if it never was. */
  endedAt: number | null;
  /** It is on the keyboard now: the config is the board's and this was the last revision verified on it. */
  current: boolean;
  summary: string;
  createdAt: number;
};

export type VersionMilestone = {
  version: VersionView;
  /** The revisions made since the version before this one, up to this one's own, newest first: the changes that led to it. */
  revisions: RevisionBrief[];
};

export type VersionHistory = {
  layoutId: string;
  layoutName: string;
  headRevisionId: string;
  /** Revisions newer than the newest version: changes made since anything was put on the keyboard. */
  pending: RevisionBrief[];
  /** Newest first. */
  versions: VersionMilestone[];
};

const brief = (r: RevisionRow): RevisionBrief => ({ id: r.id, origin: r.origin, summary: r.summary, createdAt: r.createdAt });

function requireLayout(app: App, ref: string): LayoutRow {
  const layout = findLayoutRow(app.db, ref);
  if (!layout) throw new NotFoundError(`no config "${ref}"`);
  return layout;
}

/** The revision a version stands for, named by its ID or its name. Undefined when no version of this config has that ID or name. */
export function versionRevision(app: App, layout: LayoutRow, ref: string): string | undefined {
  if (ref.startsWith("ver_")) {
    const v = findVersion(app.db, ref);
    return v && v.layoutId === layout.id ? v.revisionId : undefined;
  }
  const named = listVersionRows(app.db, layout.id).filter((v) => v.name === ref);
  if (named.length > 1) throw new UsageError(`more than one version of ${layout.name} is named "${ref}"; use its ID`);
  return named[0]?.revisionId;
}

/**
 * A revision named by a revision ID, a version ID or a version's name. Names are only tried when the text is neither kind of ID,
 * so a name can't hide a revision.
 */
export function resolveRevision(app: App, layout: LayoutRow, ref: string): string {
  if (ref.startsWith("ver_")) return versionRevision(app, layout, ref) ?? fail(layout, ref, "version");
  if (findRevision(app.db, layout.id, ref)) return ref;
  return versionRevision(app, layout, ref) ?? fail(layout, ref, "revision or version");
}

const fail = (layout: LayoutRow, ref: string, what: string): never => {
  throw new NotFoundError(`config ${layout.name} has no ${what} "${ref}"`);
};

export function versionHistory(app: App, ref: string): VersionHistory {
  const layout = requireLayout(app, ref);
  const chain = revisionChain(app.db, layout.id, layout.headRevisionId);
  const byRevision = new Map(listVersionRows(app.db, layout.id).map((v) => [v.revisionId, v]));
  const onKeyboard = getBoardConfig(app.db, layout.boardId) === layout.id;

  const pending: RevisionBrief[] = [];
  const versions: VersionMilestone[] = [];
  let open: VersionMilestone | undefined;
  for (const revision of chain) {
    const version = byRevision.get(revision.id);
    if (version) {
      open = {
        version: {
          id: version.id, revisionId: revision.id, name: version.name, putOnAt: version.putOnAt, endedAt: version.endedAt,
          current: onKeyboard && version.putOnAt !== null && version.endedAt === null, summary: revision.summary, createdAt: revision.createdAt,
        },
        revisions: [],
      };
      versions.push(open);
    } else if (open) {
      open.revisions.push(brief(revision));
    } else {
      pending.push(brief(revision));
    }
  }
  return { layoutId: layout.id, layoutName: layout.name, headRevisionId: layout.headRevisionId, pending, versions };
}

/** Names a revision (or the revision a version stands for) as a version; an empty name takes the name away, which returns null when nothing is left of the version. */
export function nameVersion(app: App, ref: string, target: string, name: string): VersionView | null {
  return transact(app.db, () => {
    const layout = requireLayout(app, ref);
    const revisionId = resolveRevision(app, layout, target);
    const trimmed = name.trim();
    storeName(app.db, { layoutId: layout.id, revisionId, boardId: layout.boardId, name: trimmed === "" ? null : trimmed });
    const history = versionHistory(app, layout.id);
    return history.versions.find((m) => m.version.revisionId === revisionId)?.version ?? null;
  });
}

/** Goes back to a version or revision as a new revision (D-170): the same path as History's "Go back", so the same validation. */
export function restoreVersion(app: App, ref: string, target: string): { revision: RevisionRow; restoredRevisionId: string } {
  const layout = requireLayout(app, ref);
  const revisionId = resolveRevision(app, layout, target);
  // A go-back after a go-back would add a revision that changes nothing, so the history would grow with every press.
  const head = findRevision(app.db, layout.id, layout.headRevisionId);
  const wanted = findRevision(app.db, layout.id, revisionId);
  if (head && wanted && deepEqual(head.layout, wanted.layout)) throw new UsageError(`${layout.name} already matches ${target}; there is nothing to go back to`);
  const { revision } = undo(app, layout.id, { to: revisionId });
  return { revision, restoredRevisionId: revisionId };
}

export type KeyChange = {
  layerId: string;
  layerName: string;
  position: number;
  before: Binding;
  after: Binding;
  /** What the cap prints, so a screen or the terminal can say it without reading bindings. */
  beforeLabel: string;
  afterLabel: string;
};

export type CompareView = {
  layoutId: string;
  /** The older revision, and the head it is compared with. */
  from: RevisionBrief;
  to: RevisionBrief;
  diff: Omit<LayoutDiff, "keys"> & { keys: KeyChange[] };
};

const contextOf = (layout: Layout) => ({ layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances, passthrough: layout.passthrough });

/**
 * The differences between a revision and the head, drawn per key: what "compare with now" shows, and what going back to the
 * revision would change. `before` is the revision's binding and `after` the head's.
 */
export function compareRevision(app: App, ref: string, target: string): CompareView {
  const layout = requireLayout(app, ref);
  const revisionId = resolveRevision(app, layout, target);
  const from = findRevision(app.db, layout.id, revisionId);
  const to = findRevision(app.db, layout.id, layout.headRevisionId);
  if (!from || !to) throw new NotFoundError(`config ${layout.name} has no revision "${target}"`);
  const diff = diffLayouts(from.layout, to.layout);
  const fromCtx = contextOf(from.layout);
  const toCtx = contextOf(to.layout);
  return {
    layoutId: layout.id,
    from: brief(from.revision),
    to: brief(to.revision),
    diff: {
      ...diff,
      keys: diff.keys.map((k) => ({ ...k, beforeLabel: bindingLabel(k.before, fromCtx), afterLabel: bindingLabel(k.after, toCtx) })),
    },
  };
}
