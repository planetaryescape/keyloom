import { useCallback, useEffect, useState } from "react";
import type { ApiConfig } from "../../api/configs.ts";
import { fetchConfigs } from "./api-configs.ts";

export type Configs = { live: ApiConfig[]; archived: ApiConfig[]; loaded: boolean; reload: () => void };

// This board's configs for the switcher (D-315): the live ones newest edited first, and the archived ones for "Archived (n)". Loads
// again when the board, the config on screen or its head changes, since a rename, archive or copy changes the list.
export function useConfigs(token: string, boardId: string, key: string): Configs {
  const [live, setLive] = useState<ApiConfig[]>([]);
  const [archived, setArchived] = useState<ApiConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchConfigs(token, boardId, { signal: controller.signal }), fetchConfigs(token, boardId, { archived: true, signal: controller.signal })]).then(
      ([all, withArchived]) => {
        setLive(all);
        setArchived(withArchived.filter((c) => c.archivedAt !== null));
        setLoaded(true);
      },
      // The switcher falls back to the config on screen alone; the page itself still works.
      () => setLoaded(true),
    );
    return () => controller.abort();
  }, [token, boardId, key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { live, archived, loaded, reload };
}
