import { useCallback, useEffect, useState } from "react";
import type { ApiConfig } from "../../api/configs.ts";
import { type PageFailure, pageFailure } from "../shell/unexpected.ts";
import { fetchConfigs } from "./api-configs.ts";

/** `failure`: the last read failed, kept with its code so the switcher offers what can work (R11-07); null once a read works. */
export type Configs = { live: ApiConfig[]; archived: ApiConfig[]; loaded: boolean; failure: PageFailure | null; reload: () => void };

// This board's configs for the switcher (D-315): the live ones newest edited first, and the archived ones for "Archived (n)". Loads
// again when the board, the config on screen or its head changes (a rename or archive of it), and on `reload`. A config made somewhere
// else changes none of those: the agent's create_config and put_config, or the CLI, add one without touching the config on screen, so
// the chat asks for `reload` when a reply names a config the list lacks (useMadeConfigRefresh).
export function useConfigs(token: string, boardId: string, key: string): Configs {
  const [live, setLive] = useState<ApiConfig[]>([]);
  const [archived, setArchived] = useState<ApiConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<PageFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchConfigs(token, boardId, { signal: controller.signal }), fetchConfigs(token, boardId, { archived: true, signal: controller.signal })]).then(
      ([all, withArchived]) => {
        setLive(all);
        setArchived(withArchived.filter((c) => c.archivedAt !== null));
        setFailure(null);
        setLoaded(true);
      },
      // The switcher falls back to the config on screen alone and says why, with a way to read it again; the page itself still works.
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setFailure(pageFailure(error, "keyloom couldn't read this keyboard's configs."));
        setLoaded(true);
      },
    );
    return () => controller.abort();
  }, [token, boardId, key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { live, archived, loaded, failure, reload };
}
