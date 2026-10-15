// `keyloom serve`: the local web app over the same use cases the CLI calls (01#server-and-transport).
import { type App, type HandsFreeOverrides, NotFoundError, type ProviderId, boardDevView, createSyncEngine, getLayout, listLayouts } from "../app/index.ts";
import type { LayoutSource } from "../server/layout-source.ts";
import { type RunningServer, startServer } from "../server/start-server.ts";
import { appChatBackend } from "./chat-backend.ts";
import { appDecisionsBackend } from "./decisions-backend.ts";
import { appEditorBackend } from "./editor-backend.ts";
import { appSyncBackend } from "./sync-backend.ts";

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

/** `keyloom serve --board-dev <board>`: no layouts and no database, just the board's keys with their position numbers. */
export function serveBoardDev(dir: string, opts: { port: number; open: boolean }): RunningServer {
  const none: LayoutSource = { list: async () => [], get: async () => null };
  return startServer({ port: opts.port, source: none, boardDev: () => boardDevView(dir), open: opts.open });
}

export function serve(app: App, opts: { port: number; open: boolean; provider?: ProviderId; handsFree?: HandsFreeOverrides }): RunningServer {
  // The engine that keeps each keyboard on its layout's head lives in this process, beside the server that shows it (D-160).
  const engine = createSyncEngine(app, opts.handsFree ? { handsFree: opts.handsFree } : {});
  const started = engine.start().catch((err: unknown) => console.error("keyloom: keyboard sync could not start", err));
  const running = startServer({
    port: opts.port, source: appLayoutSource(app), editor: appEditorBackend(app, {}, () => engine.notifyApplied()),
    chat: appChatBackend(app, opts.provider ? { provider: opts.provider } : {}), decisions: appDecisionsBackend(app), sync: appSyncBackend(engine), open: opts.open,
  });
  let drained: Promise<void> | undefined;
  return {
    ...running,
    stop: () => {
      running.stop();
      // A build is stopped; a flash is let finish, so the keyboard isn't left half written.
      drained ??= started.then(() => engine.stop());
    },
    drain: async () => {
      await drained;
    },
  };
}
