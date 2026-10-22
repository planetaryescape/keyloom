import { useCallback, useRef } from "react";
import type { Turn } from "../chat/transcript.ts";
import { madeConfigs } from "./agent-made-configs.ts";
import type { Configs } from "./useConfigs.ts";

/**
 * Reloads the config list when a reply made a config the list doesn't have, so the menu and ⌘K show it at once (the list otherwise only
 * reloads when the config on screen changes). Each made config is looked for once, so streaming updates to the same reply, or a config
 * that lives on another board's list, don't fetch again. Returns the handler for the chat's `onTurns`.
 */
export function useMadeConfigRefresh(configs: Configs): (turns: readonly Turn[]) => void {
  const looked = useRef(new Set<string>());
  const latest = useRef(configs);
  latest.current = configs;
  return useCallback((turns) => {
    const { loaded, live, reload } = latest.current;
    // Before the first load there is nothing to compare with, and that load will include what exists.
    if (!loaded) return;
    let missing = false;
    for (const turn of turns) {
      if (turn.kind !== "assistant") continue;
      for (const { id } of madeConfigs(turn.presentation)) {
        if (looked.current.has(id) || live.some((config) => config.id === id)) continue;
        looked.current.add(id);
        missing = true;
      }
    }
    if (missing) reload();
  }, []);
}
