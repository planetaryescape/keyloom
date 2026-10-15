// `keyloom serve`: the local web app over the same use cases the CLI calls (01#server-and-transport).
import { type App, NotFoundError, getLayout, listLayouts } from "../app/index.ts";
import type { LayoutSource } from "../server/layout-source.ts";
import { type RunningServer, startServer } from "../server/start-server.ts";
import { appChatBackend } from "./chat-backend.ts";
import { appEditorBackend } from "./editor-backend.ts";

export const DEFAULT_PORT = 4477;

/** Adapts the app's layout use cases to the server's read interface. */
export function appLayoutSource(app: App): LayoutSource {
  return {
    async list() {
      return listLayouts(app).map((r) => ({
        id: r.id,
        name: r.name,
        boardId: r.boardId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        revisionId: r.headRevisionId,
      }));
    },
    async get(ref) {
      try {
        const view = getLayout(app, ref);
        const r = view.revision;
        return {
          revision: { id: r.id, parentId: r.parentId, origin: r.origin, summary: r.summary, createdAt: r.createdAt, undoable: r.parentId !== null },
          document: view.document,
          board: view.board.definition,
          geometry: view.board.geometry,
        };
      } catch (err) {
        // An unknown ref is the server's 404; anything else is a real failure (500).
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
  };
}

export function serve(app: App, opts: { port: number; open: boolean }): RunningServer {
  return startServer({ port: opts.port, source: appLayoutSource(app), editor: appEditorBackend(app), chat: appChatBackend(app), open: opts.open });
}
