import { ArchiveRestore, ArrowLeft, ArrowRight, ClipboardCheck, Keyboard } from "lucide-react";
import type { ChatPresentation } from "../../api/http.ts";
import { madeConfigs } from "../configs/agent-made-configs.ts";
import { configCardView, type CardOrigin, type ConfigCardAction, type ConfigCardData } from "../configs/config-card.ts";
import { useEffect, useRef, useState } from "react";
import { restoreConfig } from "../configs/api-configs.ts";
import { pageFailure, type PageFailure } from "../shell/unexpected.ts";
import { FailureNote, RetryOrRestart } from "../shell/UnexpectedWayOut.tsx";

/** What a reply's config cards need from the page: the cards' data, which config is on screen, and how to open one. */
export type ConfigCards = {
  data: ReadonlyMap<string, ConfigCardData>;
  currentId: string;
  /** The config BK asked from, when this thread was carried here from it. */
  origin: CardOrigin | null;
  onOpen: (id: string) => void;
  /** Shows this config's waiting proposals beside the board; the config is the one on screen. */
  onReview: () => void;
  /** Reads the config list again, for a card whose read failed (R11-07). */
  onReadAgain: () => void;
  token: string;
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
            {data.state !== "error" ? null : (
              <div className="config-card-actions">
                <RetryOrRestart token={cards.token} failure={data.failure} onRetry={cards.onReadAgain} className="button config-card-action" />
              </div>
            )}
            {view.action === null ? null : (
              <div className="config-card-actions">
                <CardButton key={view.action.kind} action={view.action} cards={cards} primary />
                {view.secondary === null ? null : <CardButton action={view.secondary} cards={cards} link />}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

const ICONS = { open: ArrowRight, back: ArrowLeft, review: ClipboardCheck, restore: ArchiveRestore };

function CardButton({ action, cards, primary = false, link = false }: { action: ConfigCardAction; cards: ConfigCards; primary?: boolean; link?: boolean }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const Icon = ICONS[action.kind];
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<PageFailure | null>(null);
  async function act() {
    if (saving) return;
    if (action.kind === "review") { cards.onReview(); return; }
    if (action.kind !== "restore") { cards.onOpen(action.id); return; }
    setSaving(true);
    setFailure(null);
    try {
      // Use the same restore route as Archived in the config menu. Opening never puts it on hardware.
      await restoreConfig(cards.token, action.id);
      if (!mounted.current) return;
      cards.onReadAgain();
      cards.onOpen(action.id);
    } catch (error) {
      if (mounted.current) setFailure(pageFailure(error, "keyloom couldn't restore this config."));
    } finally { if (mounted.current) setSaving(false); }
  }
  return (
    <>
    <button type="button" className={primary ? "button config-card-action button-primary" : link ? "button config-card-action config-card-back" : "button config-card-action"} disabled={saving} onClick={() => void act()}>
      <Icon size={14} aria-hidden="true" />
      {saving ? "Restoring…" : action.label}
    </button>
    {failure === null ? null : <FailureNote token={cards.token} failure={failure} className="chat-inline-error" />}
    </>
  );
}
