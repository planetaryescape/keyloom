// The server's remapper setup interface over the app (D-492, D-493). `brew install kanata` takes minutes, so it runs as a job the status
// read follows (R2-06): a second press joins the install already running, and Cancel stops it.
import { type SetupDeps, kanataInstaller, openSettingsPane, readKanataLog, realSetupDeps, remapperSetupStatus, restartKanataService, startKanataDaemon } from "../app/remapper-setup.ts";
import type { RemapperSetupBackend } from "../server/system-remapper-routes.ts";

export function appRemapperSetupBackend(deps: SetupDeps = realSetupDeps()): RemapperSetupBackend {
  const installer = kanataInstaller(deps);
  return {
    status: (boardId) => remapperSetupStatus(boardId, deps, installer.state()),
    installKanata: async (action) => installer.start(action),
    cancelInstall: async () => installer.cancel(),
    startKanata: (boardId) => startKanataDaemon(boardId, deps),
    restartKanata: (boardId) => restartKanataService(boardId, deps),
    kanataLog: () => readKanataLog(deps),
    openSettings: (pane) => openSettingsPane(pane, deps),
  };
}
