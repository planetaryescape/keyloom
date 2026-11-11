// The server's remapper setup interface over the app (D-492, D-493). `brew install kanata` takes minutes, and a second click
// joins the install already running instead of starting another.
import { type SetupDeps, installKanata, openSettingsPane, realSetupDeps, remapperSetupStatus, startKanataDaemon } from "../app/remapper-setup.ts";
import type { SetupActionResponse } from "../api/system-remapper.ts";
import type { RemapperSetupBackend } from "../server/system-remapper-routes.ts";

export function appRemapperSetupBackend(deps: SetupDeps = realSetupDeps()): RemapperSetupBackend {
  let installing: Promise<SetupActionResponse> | null = null;
  return {
    status: (boardId) => remapperSetupStatus(boardId, deps, installing !== null),
    installKanata: () => {
      installing ??= installKanata(deps).finally(() => {
        installing = null;
      });
      return installing;
    },
    startKanata: (boardId) => startKanataDaemon(boardId, deps),
    openSettings: (pane) => openSettingsPane(pane, deps),
  };
}
