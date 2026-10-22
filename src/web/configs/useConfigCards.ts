import { useEffect, useState } from "react";
import { fetchOpenProposals } from "../keyboards/api-keyboards.ts";
import { fetchAllConfigs } from "./api-configs.ts";
import type { ConfigCardData } from "./config-card.ts";

/**
 * What the config cards in a thread show: each made config's name, board, source and open proposals. One list fetch serves every card,
 * and it runs again when `refreshKey` changes (a rename, an archive or an applied proposal changes what a card says). A config that is
 * not in the list is gone; an unreadable answer is an error, never "gone".
 */
export function useConfigCards(token: string, ids: readonly string[], refreshKey: string): ReadonlyMap<string, ConfigCardData> {
  const [cards, setCards] = useState<ReadonlyMap<string, ConfigCardData>>(new Map());
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
          const waiting = await fetchOpenProposals(token, id, controller.signal).then((proposals) => proposals.filter((p) => p.status === "proposed").length, () => null);
          next.set(id, waiting === null ? { state: "error" } : { state: "ready", config, waiting });
        }));
        if (!controller.signal.aborted) setCards((now) => new Map([...now, ...next]));
      },
      () => {
        if (!controller.signal.aborted) setCards((now) => new Map([...now, ...list.map((id): [string, ConfigCardData] => [id, now.get(id) ?? { state: "error" }])]));
      },
    );
    return () => controller.abort();
  }, [token, wanted, refreshKey]);
  return cards;
}
