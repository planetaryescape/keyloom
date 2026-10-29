import { ArrowLeft, ArrowRight, ClipboardCheck, Keyboard } from "lucide-react";
import type { ChatPresentation } from "../../api/http.ts";
import { madeConfigs } from "../configs/agent-made-configs.ts";
import { configCardView, type CardOrigin, type ConfigCardAction, type ConfigCardData } from "../configs/config-card.ts";

/** What a reply's config cards need from the page: the cards' data, which config is on screen, and how to open one. */
export type ConfigCards = {
  data: ReadonlyMap<string, ConfigCardData>;
  currentId: string;
  /** The config BK asked from, when this thread was carried here from it. */
  origin: CardOrigin | null;
  onOpen: (id: string) => void;
  /** Shows this config's waiting proposals beside the board; the config is the one on screen. */
  onReview: () => void;
};

/** A card for each config the reply made (put_config, create_config), also on a stopped or failed reply when the config was committed. */
export function ConfigCardList({ presentation, cards }: { presentation: ChatPresentation | undefined; cards: ConfigCards | undefined }) {
  if (cards === undefined) return null;
  const made = madeConfigs(presentation);
  if (made.length === 0) return null;
  return (
    <>
      {made.map(({ id }) => {
        const data: ConfigCardData = cards.data.get(id) ?? { state: "loading" };
        // This endpoint counts proposals outside chat; a handoff's proposal lives in its target conversation.
        const counted = data.state === "ready" && presentation?.handoff?.layoutId === id ? { ...data, waiting: null } : data;
        const view = configCardView(counted, cards.currentId, cards.origin, id);
        return (
          <section key={id} className="ask-card ask-card-done config-card" aria-label={`Config ${view.title}`}>
            <p className="ask-question config-card-title"><Keyboard size={14} aria-hidden="true" /><span>{view.title}</span></p>
            {view.facts.length === 0 ? null : <p className="ask-description config-card-facts">{view.facts.join(" · ")}</p>}
            {view.note === null ? null : <p className="ask-description">{view.note}</p>}
            {view.action === null ? null : (
              <div className="config-card-actions">
                <CardButton action={view.action} cards={cards} primary />
                {view.secondary === null ? null : <CardButton action={view.secondary} cards={cards} link />}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

const ICONS = { open: ArrowRight, back: ArrowLeft, review: ClipboardCheck };

function CardButton({ action, cards, primary = false, link = false }: { action: ConfigCardAction; cards: ConfigCards; primary?: boolean; link?: boolean }) {
  const Icon = ICONS[action.kind];
  return (
    <button type="button" className={primary ? "button config-card-action button-primary" : link ? "button config-card-action config-card-back" : "button config-card-action"} onClick={() => (action.kind === "review" ? cards.onReview() : cards.onOpen(action.id))}>
      <Icon size={14} aria-hidden="true" />
      {action.label}
    </button>
  );
}
