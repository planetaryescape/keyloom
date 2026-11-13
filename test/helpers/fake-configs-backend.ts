import type { ApiConfig } from "../../src/api/configs.ts";
import type { RevisionEntry } from "../../src/api/http.ts";
import { type ConfigsBackend, ConfigsError } from "../../src/server/configs-backend.ts";
import type { LayoutSource } from "../../src/server/layout-source.ts";

/**
 * How a read fails, for the dev editor's switches: a server exception, an answer the page can't read, or (proposals only) the route's own
 * `not_found`, as for a config deleted in another window.
 */
export type ConfigsReadFailure = "internal" | "unreadable" | "gone";

export interface FakeConfigsOptions {
  boardName: string;
  /** The editor's history, for the versions read: every revision is "pending", with no version yet. */
  revisions: () => Promise<RevisionEntry[]>;
  failList?: Exclude<ConfigsReadFailure, "gone"> | undefined;
  failProposals?: ConfigsReadFailure | undefined;
}

const fail = (how: ConfigsReadFailure, ref: string): never => {
  // A plain Error is the server's exception (500 internal); a ConfigsError is the route's own answer.
  if (how === "internal") throw new Error("database is locked");
  if (how === "gone") throw new ConfigsError(404, "not_found", `no config "${ref}"`);
  throw new ConfigsError(400, "unreadable", "The dev editor answers this as a keyloom of another version would.");
};

/**
 * The configs routes over the dev editor's one layout (R11 fixture): the list, versions and the open proposals answer as `keyloom serve`
 * does, so a dev-editor page shows no "Couldn't read proposals" that the real app never shows. Writes are refused in words, because the
 * dev editor keeps one config in memory.
 */
export function fakeConfigsBackend(source: LayoutSource, options: FakeConfigsOptions): ConfigsBackend {
  const rows = async (): Promise<ApiConfig[]> =>
    (await source.list()).map((layout, index) => ({
      id: layout.id, name: layout.name, boardId: layout.boardId, boardName: options.boardName, headRevisionId: layout.revisionId,
      createdAt: layout.createdAt, updatedAt: layout.updatedAt, onKeyboard: index === 0, archivedAt: null, copiedFrom: null,
    }));
  const list = async (): Promise<ApiConfig[]> => {
    if (options.failList !== undefined) fail(options.failList, "configs");
    return rows();
  };
  // The versions and proposals reads look the config up without the list switch, so configs= fails only the list (PR #318 review).
  const known = async (ref: string): Promise<ApiConfig> => {
    const found = (await source.list()).find((layout) => layout.id === ref || layout.name === ref);
    if (found === undefined) throw new ConfigsError(404, "not_found", `no config "${ref}"`);
    const config = (await rows()).find((candidate) => candidate.id === found.id);
    if (config === undefined) throw new ConfigsError(404, "not_found", `no config "${ref}"`);
    return config;
  };
  const refused = async (): Promise<never> => {
    throw new ConfigsError(400, "usage", "The dev editor keeps one config, so it doesn't make, rename or put configs on a keyboard.");
  };
  return {
    list: async (opts) => (await list()).filter((config) => opts.board === undefined || config.boardId === opts.board),
    create: refused, rename: refused, archive: refused, restore: refused, remove: refused, use: refused, nameVersion: refused, restoreVersion: refused, compare: refused,
    versions: async (ref) => {
      const config = await known(ref);
      const pending = (await options.revisions()).map((r) => ({ id: r.id, origin: r.origin, summary: r.summary, createdAt: r.createdAt }));
      return { layoutId: config.id, layoutName: config.name, headRevisionId: config.headRevisionId, pending, versions: [] };
    },
    proposals: async (ref) => {
      if (options.failProposals !== undefined) fail(options.failProposals, ref);
      await known(ref);
      return [];
    },
  };
}
