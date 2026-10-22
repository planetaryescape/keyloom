import { ArrowLeft, ArrowRight, Keyboard } from "lucide-react";
import type { ChatPresentation } from "../../api/http.ts";
import { madeConfigs } from "../configs/agent-made-configs.ts";
import { configCardView, type CardOrigin, type ConfigCardData } from "../configs/config-card.ts";

/** What a reply's config cards need from the page: the cards' data, which config is on screen, and how to open one. */
export type ConfigCards = {
  data: ReadonlyMap<string, ConfigCardData>;
  currentId: string;
  /** The config BK asked from, when this thread was carried here from it. */
  origin: CardOrigin | null;
  onOpen: (id: string) => void;
};

/** A card for each config the reply made (put_config, create_config), also on a stopped or failed reply when the config was committed. */
export function ConfigCardList({ presentation, cards }: { presentation: ChatPresentation | undefined; cards: ConfigCards | undefined }) {
  if (cards === undefined) return null;
  const made = madeConfigs(presentation);
  if (made.length === 0) return null;
  return (
    <>
      {made.map(({ id }) => {
        const view = configCardView(cards.data.get(id) ?? { state: "loading" }, cards.currentId, cards.origin, id);
        const action = view.action;
        const Icon = action?.kind === "back" ? ArrowLeft : ArrowRight;
        return (
          <section key={id} className="ask-card ask-card-done config-card" aria-label={`Config ${view.title}`}>
            <p className="ask-question config-card-title"><Keyboard size={14} aria-hidden="true" /><span>{view.title}</span></p>
            {view.facts.length === 0 ? null : <p className="ask-description config-card-facts">{view.facts.join(" · ")}</p>}
            {view.note === null ? null : <p className="ask-description">{view.note}</p>}
            {action === null ? null : (
              <button type="button" className="button config-card-action" onClick={() => cards.onOpen(action.id)}>
                <Icon size={14} aria-hidden="true" />
                {action.label}
              </button>
            )}
          </section>
        );
      })}
    </>
  );
}
