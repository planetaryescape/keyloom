import { Cpu } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatProviderStatus } from "../../api/http.ts";
import { chooseProvider } from "./api-chat.ts";
import type { Pinned } from "./transcript.ts";

type Provider = ChatProviderStatus["providers"][number];

const NAMES: Record<Provider["id"], string> = { anthropic: "Anthropic", openrouter: "OpenRouter", codex: "Codex" };

interface Props {
  token: string;
  status: ChatProviderStatus | null;
  /** The provider and model the open conversation started on; it can't switch (D-111). */
  pinned: Pinned | null;
  onChanged: (status: ChatProviderStatus) => void;
  /** The command bar opens the picker from its menu and shows no model line: the model surfaces only when it fails (P3 review). */
  menuOpened?: { open: boolean; onClose: () => void };
}

// Which model answers, and the way to change it for the next conversation (19#choosing-a-provider).
// The choice goes to the data directory's config.json; a conversation already going keeps its own.
export function ProviderPicker({ token, status, pinned, onChanged, menuOpened }: Props) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<Provider["id"]>("anthropic");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const id = useId();
  const bar = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLFormElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const shownOpen = menuOpened === undefined ? open : menuOpened.open && open;
  // Opened from the bar's menu: start from what the next conversation would use, each time it opens.
  const outsideOpen = menuOpened?.open ?? false;
  useEffect(() => {
    if (outsideOpen) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outsideOpen]);

  useLayoutEffect(() => {
    const element = picker.current;
    if (!shownOpen || element === null) return;
    const trigger = bar.current?.closest(".chat")?.querySelector<HTMLElement>(".bar-more, .provider-change")
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    returnFocus.current = trigger;
    const position = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      element.style.width = `${Math.max(0, Math.min(340, width - 24))}px`;
      element.style.maxHeight = `${Math.max(0, height - 24)}px`;
      const anchor = trigger?.getBoundingClientRect() ?? bar.current?.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      const x = Math.max(left + 12, Math.min(anchor?.left ?? left + 12, left + width - bounds.width - 12));
      const above = (anchor?.top ?? top + 12) - bounds.height - 8;
      const below = (anchor?.bottom ?? top + 12) + 8;
      const y = above >= top + 12 ? above : Math.min(below, top + height - bounds.height - 12);
      element.style.left = `${x}px`;
      element.style.top = `${Math.max(top + 12, y)}px`;
    };
    position();
    element.querySelector<HTMLInputElement>("input:checked, input:not([disabled])")?.focus({ preventScroll: true });
    let frame = 0;
    const schedulePosition = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => { frame = 0; position(); });
    };
    const observer = new ResizeObserver(schedulePosition);
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) {
        setOpen(false);
        menuOpened?.onClose();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", escape, true);
    observer.observe(element);
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    window.visualViewport?.addEventListener("resize", schedulePosition);
    window.visualViewport?.addEventListener("scroll", schedulePosition);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", escape, true);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
      window.visualViewport?.removeEventListener("resize", schedulePosition);
      window.visualViewport?.removeEventListener("scroll", schedulePosition);
    };
  }, [shownOpen]);

  if (status === null && pinned === null) return null;
  const shown = pinned ? { provider: pinned.provider, model: pinned.model } : (status?.active ?? null);
  const chosen = status?.providers.find((candidate) => candidate.id === provider);

  function start() {
    // Starts from what the next conversation would use, so Save without a change is a no-op rather than a surprise.
    setProvider(status?.active?.provider ?? status?.providers[0]?.id ?? "anthropic");
    setModel(status?.active?.model ?? "");
    setProblem(null);
    setSaved(null);
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      const typed = model.trim();
      // The default is not written, so a later change to it applies; only a model BK typed is pinned.
      const next = await chooseProvider(token, { provider, ...(typed === "" || typed === chosen?.defaultModel ? {} : { model: typed }) });
      onChanged(next);
      close();
      setSaved(next.active === null ? null : `Next conversation: ${NAMES[next.active.provider]}, ${next.active.model}.`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't save the choice.");
    } finally {
      setSaving(false);
    }
  }

  const locked = status?.lockedBy ?? null;
  const close = () => {
    setOpen(false);
    menuOpened?.onClose();
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
  };
  return (
    <div ref={bar} className="provider-bar" data-from-menu={menuOpened !== undefined}>
      {menuOpened !== undefined ? null : <p className="chat-provider">
        <Cpu size={12} aria-hidden="true" />
        {shown === null ? (
          <span>No model set up</span>
        ) : (
          <>
            <span>{NAMES[shown.provider]}</span>
            {shown.model === null ? null : <span className="chat-provider-model">{shown.model}</span>}
          </>
        )}
        {status === null ? null : (
          <button type="button" className="link-button provider-change" aria-expanded={open} onClick={() => (open ? setOpen(false) : start())}>
            {open ? "Cancel" : "Change"}
          </button>
        )}
      </p>}
      {saved === null || open || menuOpened !== undefined ? null : (
        <p className="provider-saved" role="status">{pinned === null ? saved : `${saved} This conversation stays on ${NAMES[pinned.provider]}.`}</p>
      )}
      {!shownOpen || status === null ? null : createPortal(
        <form
          ref={picker}
          role="dialog"
          aria-label="Model for the next conversation"
          className="provider-picker"
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="provider-picker-content">
          <fieldset disabled={saving || locked !== null}>
            <legend>Model for the next conversation</legend>
            {status.providers.map((candidate) => (
              <label key={candidate.id} className="provider-choice" data-ready={candidate.ready}>
                <input
                  type="radio"
                  name={`${id}-provider`}
                  checked={provider === candidate.id}
                  onChange={() => {
                    setProvider(candidate.id);
                    setModel(candidate.id === status.active?.provider ? status.active.model : "");
                  }}
                />
                <span className="provider-choice-text">
                  <strong>{NAMES[candidate.id]}</strong>
                  <span className="muted">{candidate.ready ? "Ready" : `Needs setup. ${candidate.setup}`}</span>
                </span>
              </label>
            ))}
            <label className="provider-model">
              <span>Model</span>
              <input value={model} placeholder={chosen?.defaultModel ?? ""} spellCheck={false} onChange={(event) => setModel(event.target.value)} />
            </label>
          </fieldset>
          {locked === null ? null : (
            <p className="chat-inline-error" role="status">
              keyloom was started with {locked === "--provider" ? "--provider" : "KEYLOOM_PROVIDER"}, which outranks this choice. Restart it without that to choose here.
            </p>
          )}
          {chosen === undefined || chosen.ready || locked !== null ? null : (
            <p className="muted">{NAMES[chosen.id]} has no credential yet. You can choose it now; set it up before the next conversation: <code>{chosen.command}</code></p>
          )}
          {problem === null ? null : <p className="chat-inline-error" role="alert">{problem}</p>}
          </div>
          <div className="provider-actions">
            <button type="button" className="button" onClick={close}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={saving || locked !== null}>Use for new conversations</button>
          </div>
        </form>, document.body
      )}
    </div>
  );
}
