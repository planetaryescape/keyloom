// `keyloom serve`: the local web app over the same use cases the CLI calls (01#server-and-transport).
import {
  type AddDeps, type App, type FlashOptions, type HandsFreeOverrides, NotFoundError, type ProviderId, ReviewEngine, type ReviewOptions, type SyncDeps, boardDevView, createSyncEngine, defaultAgentModel, getLayout,
  listLayouts, upgradeOffer, drainDeviceConsumers, drainManualFlashTasks, shutdownDeviceConnections,
} from "../app/index.ts";
import type { AgentModel } from "../app/index.ts";
import type { LayoutSource } from "../server/layout-source.ts";
import { type RunningServer, startServer } from "../server/start-server.ts";
import { appChatBackend } from "./chat-backend.ts";
import { appConfigsBackend } from "./configs-backend.ts";
import { appKeyboardsBackend } from "./keyboards-backend.ts";
import { appLabBackend } from "./lab-backend.ts";
import { type LabDeps, realLabDeps } from "../app/index.ts";
import { appDecisionsBackend } from "./decisions-backend.ts";
import { appEditorBackend } from "./editor-backend.ts";
import { appReviewBackend } from "./review-backend.ts";
import { appSyncBackend } from "./sync-backend.ts";
import { createDataVersionWatcher } from "./data-version-watcher.ts";
import { drainAgentRuns, reconcileAgentRuns } from "../app/agent-runs.ts";

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
          upgrade: upgradeOffer(view),
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

export type ServeOptions = {
  port: number;
  open: boolean;
  provider?: ProviderId;
  /** How keyboards are found and restarted, for the sync engine and the Build and flash dialog alike; the machine's own when omitted. Tests and demos pass fakes. */
  handsFree?: HandsFreeOverrides;
  /** How the sync engine builds and flashes; the build and flash use cases when omitted. */
  syncDeps?: SyncDeps;
  /** Where boot drives appear and how long a flash waits, for the Build and flash dialog and the engine. */
  flash?: Pick<FlashOptions, "volumesRoot" | "bootloaderWaitMs">;
  /** How the typing lab reads the keyboard and replays it; the real keyboard and emulator when omitted. Tests pass a scripted keyboard. */
  lab?: LabDeps;
  /** The board review's agent (D-340): which model it runs on, and when it starts. The configured provider when omitted; tests pass a fake. */
  review?: ReviewOptions & { model?: () => Promise<AgentModel> };
  /** Where a new keyboard's layout is read from (the pinned firmware trees) and which boards count as known; GitHub and every board when omitted. Tests pass fixtures. */
  keyboards?: AddDeps;
};

export function serve(app: App, opts: ServeOptions): RunningServer {
  reconcileAgentRuns(app);
  // The engine that keeps each keyboard on its layout's head lives in this process, beside the server that shows it (D-160).
  const engine = createSyncEngine(app, { ...(opts.handsFree ? { handsFree: opts.handsFree } : {}), ...(opts.syncDeps ? { deps: opts.syncDeps } : {}), ...(opts.flash ?? {}) });
  // The review follows the sync engine's boards for its connect trigger, so it subscribes before the engine's first reading.
  const { model, ...reviewOptions } = opts.review ?? {};
  const reviews = new ReviewEngine(app, { model: model ?? (() => defaultAgentModel(app.dataDir, opts.provider ? { provider: opts.provider } : {})) }, reviewOptions);
  reviews.start(engine);
  const started = engine.start();
  void started.catch((err: unknown) => console.error("keyloom: keyboard sync could not start", err));
  const watcher = createDataVersionWatcher(app.db);
  const lab = appLabBackend(app, opts.lab ?? realLabDeps());
  const running = startServer({
    port: opts.port, source: appLayoutSource(app), editor: appEditorBackend(app, { ...(opts.flash ?? {}), ...(opts.handsFree ? { handsFree: opts.handsFree } : {}) }, () => engine.notifyApplied()),
    chat: appChatBackend(app, opts.provider ? { provider: opts.provider } : {}), decisions: appDecisionsBackend(app), sync: appSyncBackend(engine, reviews, watcher), review: appReviewBackend(reviews), configs: appConfigsBackend(app, engine, opts.keyboards ?? {}), keyboards: appKeyboardsBackend(app, engine, opts.keyboards ?? {}), lab, open: opts.open,
  });
  let drained: Promise<void> | undefined;
  return {
    ...running,
    stop: () => {
      watcher.stop();
      running.stop();
      // A build is stopped; manual and sync flashes are let finish so the keyboard isn't left half written.
      drained ??= drainDeviceConsumers(
        [lab.cancel(), drainAgentRuns(app), drainDeviceConsumers(
          [started], () => drainDeviceConsumers([engine.stop(), reviews.stop()], async () => {}),
        ), drainManualFlashTasks(app)],
        shutdownDeviceConnections,
      );
    },
    drain: async () => {
      await drained;
    },
  };
}
