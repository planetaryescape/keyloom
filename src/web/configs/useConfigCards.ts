import { useCallback, useEffect, useState } from "react";
import { fetchOpenProposals } from "../keyboards/api-keyboards.ts";
import { pageFailure } from "../shell/unexpected.ts";
import { fetchAllConfigs } from "./api-configs.ts";
import type { ConfigCardData } from "./config-card.ts";

/** Each card's data, and a way to read the list again after a failed read. */
export type ConfigCardsRead = { data: ReadonlyMap<string, ConfigCardData>; reload: () => void };

/**
 * What the config cards in a thread show: each made config's name, board, source and open proposals. One list fetch serves every card,
 * and it runs again when `refreshKey` changes (a rename, an archive or an applied proposal changes what a card says). A config that is
 * not in the list is gone; an unreadable list is an error, never "gone"; unreadable proposals only drop the count. An error keeps its code,
 * and `reload` reads the list again, so the card's Try again works without waiting for the revision to change (R11-07).
 */
export function useConfigCards(token: string, ids: readonly string[], refreshKey: string): ConfigCardsRead {
  const [cards, setCards] = useState<ReadonlyMap<string, ConfigCardData>>(new Map());
  const [attempt, setAttempt] = useState(0);
  const wanted = [...new Set(ids)].sort().join("\n");
  useEffect(() => {
    if (wanted === "") return;
    const controller = new AbortController();
    const list = wanted.split("\n");
    fetchAllConfigs(token, controller.signal).then(
      async (configs) => {
        const next = new Map<string, ConfigCardData>();
        await Promise.all(list.map(async (id) => {
          const config = configs.find((candidate) => candidate.id === id);
          if (config === undefined) return void next.set(id, { state: "gone" });
          // Without its proposals the config is still known; the card leaves the count out.
          const waiting = await fetchOpenProposals(token, id, controller.signal).then((proposals) => proposals.filter((p) => p.status === "proposed").length, () => null);
          next.set(id, { state: "ready", config, waiting });
        }));
        if (!controller.signal.aborted) setCards((now) => new Map([...now, ...next]));
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        // A card that showed its config keeps it; the others say the read failed, with the failure's code for their buttons.
        const failure = pageFailure(error, "keyloom couldn't read your configs.");
        setCards((now) => new Map([...now, ...list.map((id): [string, ConfigCardData] => {
          const shown = now.get(id);
          return [id, shown === undefined || shown.state === "error" ? { state: "error", failure } : shown];
        })]));
      },
    );
    return () => controller.abort();
  }, [token, wanted, refreshKey, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data: cards, reload };
}
