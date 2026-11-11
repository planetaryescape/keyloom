import { Check, CircleCheck, Copy, ExternalLink, KeyRound, LoaderCircle, LogIn, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ChatProviderStatus } from "../../api/http.ts";
import { ApiError } from "../api.ts";
import { fetchProviderStatus } from "./api-chat.ts";
import { type KeyProvider, cancelCodexSignIn, forgetProviderKey, saveProviderKey, startCodexSignIn } from "./api-setup.ts";
import { KEY_PAGES, PROVIDER_NAMES, failureReloads, setupView } from "./setup-words.ts";
import "./setup.css";

type Provider = ChatProviderStatus["providers"][number];

const KEY_PLACEHOLDERS: Record<KeyProvider, string> = { anthropic: "Paste your key (sk-ant-…)", openrouter: "Paste your key (sk-or-…)" };

/** How often the page asks whether `codex login` has finished. */
const SIGN_IN_POLL_MS = 1_500;

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    // Clipboard access can be refused; the command stays selectable either way.
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  }
  return (
    <div className="command">
      <code>{command}</code>
      <button type="button" className="button" onClick={copy} aria-label={`Copy ${command}`}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function KeyPageLink({ href, name }: { href: string; name: string }) {
  return (
    <a className="setup-key-page" href={href} target="_blank" rel="noreferrer">
      Get an {name} key
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

function PasteKey({ token, id, note, onSaved, onReload, onCancel }: {
  token: string; id: KeyProvider; note: string;
  onSaved: (status: ChatProviderStatus, checked: boolean) => void; onReload: () => void; onCancel?: (() => void) | undefined;
}) {
  const field = useId();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      const saved = await saveProviderKey(token, id, key);
      // The page keeps no copy once the server has it.
      setKey("");
      onSaved(saved.status, saved.checked);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      setProblem(error instanceof Error ? error.message : "keyloom couldn't save the key.");
      if (failureReloads(code)) onReload();
    } finally {
      setSaving(false);
    }
  }
  return (
    // A group, not a form: the provider picker that can hold this is a form already, and forms don't nest.
    <div className="setup-paste">
      <div className="setup-paste-row">
        <input
          id={field}
          type="password"
          aria-label={`${PROVIDER_NAMES[id]} API key`}
          placeholder={KEY_PLACEHOLDERS[id]}
          autoComplete="off"
          spellCheck={false}
          value={key}
          disabled={saving}
          aria-invalid={problem !== null}
          aria-describedby={`${field}-note`}
          onChange={(event) => { setKey(event.target.value); setProblem(null); }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.stopPropagation();
            if (key.trim() !== "" && !saving) void save();
          }}
        />
        <button type="button" className="button button-primary" disabled={saving || key.trim() === ""} onClick={() => void save()}>
          {saving ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />}
          {saving ? "Checking" : "Save and use it"}
        </button>
      </div>
      {problem === null ? null : <p className="chat-inline-error" role="alert">{problem}</p>}
      <p id={`${field}-note`} className="muted">
        {note} <KeyPageLink href={KEY_PAGES[id]} name={PROVIDER_NAMES[id]} />
      </p>
      {onCancel === undefined ? null : <button type="button" className="link-button" onClick={onCancel}>Keep the saved key</button>}
    </div>
  );
}

function ProviderSetup({ token, provider, status, onChanged, onReload, replacing }: {
  token: string; provider: Provider; status: ChatProviderStatus; onChanged: (status: ChatProviderStatus) => void; onReload: () => void; replacing: boolean;
}) {
  const view = setupView(provider, status);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [replace, setReplace] = useState(replacing);
  const [saved, setSaved] = useState<string | null>(null);
  const name = PROVIDER_NAMES[provider.id];

  async function act(run: () => Promise<ChatProviderStatus>) {
    setBusy(true);
    setProblem(null);
    try {
      onChanged(await run());
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't work.");
      onReload();
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === "hidden") return null;
  const id = provider.id === "codex" ? null : provider.id;
  return (
    <li className="setup-provider" data-ready={provider.ready}>
      <strong>{name}</strong>
      {view.kind === "ready" && !(replace && id !== null) ? (
        <>
          <p className="setup-ready"><CircleCheck size={14} aria-hidden="true" />{view.text}</p>
          {saved === null ? null : <p className="muted" role="status">{saved}</p>}
          {view.forget && id !== null ? (
            <div className="setup-actions">
              <button type="button" className="button" disabled={busy} onClick={() => setReplace(true)}>
                <KeyRound size={14} aria-hidden="true" />
                Replace the key
              </button>
              <button type="button" className="button" disabled={busy} onClick={() => void act(() => forgetProviderKey(token, id))}>
                <Trash2 size={14} aria-hidden="true" />
                Forget this key
              </button>
            </div>
          ) : null}
        </>
      ) : view.kind === "paste" || (view.kind === "ready" && id !== null) ? (
        id === null ? null : (
          <PasteKey
            token={token}
            id={id}
            note={view.kind === "paste" ? view.note : `keyloom checks the new key with ${name}, then replaces the saved one.`}
            onReload={onReload}
            onCancel={view.kind === "ready" ? () => setReplace(false) : undefined}
            onSaved={(next, checked) => {
              setReplace(false);
              setSaved(checked ? "Saved. Chat uses it from the next message." : `Saved. keyloom couldn't reach ${name} to check it, so the first message will tell.`);
              onChanged(next);
            }}
          />
        )
      ) : view.kind === "env-only" ? (
        <>
          <p className="muted">{view.text} <KeyPageLink href={view.keyPage} name={name} /></p>
          <CopyCommand command={view.command} />
        </>
      ) : view.kind === "codex-waiting" ? (
        <>
          <p className="setup-waiting" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" />Finish signing in in your browser. keyloom picks it up when you're done.</p>
          <div className="setup-actions">
            {view.url === null ? null : (
              <a className="button" href={view.url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden="true" />
                Open the sign-in page again
              </a>
            )}
            <button type="button" className="button" disabled={busy} onClick={() => void act(() => cancelCodexSignIn(token))}>Stop waiting</button>
          </div>
        </>
      ) : view.kind === "codex-sign-in" ? (
        <>
          {view.failed === null ? <p className="muted">{view.text}</p> : <p className="chat-inline-error" role="alert">{view.failed} Try signing in again.</p>}
          <div className="setup-actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void act(() => startCodexSignIn(token))}>
              <LogIn size={14} aria-hidden="true" />
              Sign in with Codex
            </button>
          </div>
        </>
      ) : null}
      {problem === null ? null : <p className="chat-inline-error" role="alert">{problem}</p>}
    </li>
  );
}

interface Props {
  token: string;
  status: ChatProviderStatus | null;
  onChanged: (status: ChatProviderStatus) => void;
  /** Re-reads the status: after a failure, and to retry a status that couldn't be read. */
  onReload: () => void;
  /** Only these providers, for the picker's one unready choice. */
  only?: readonly Provider["id"][];
  /** Opens this provider's field over a saved key, after the provider refused it. */
  replacing?: Provider["id"] | null;
}

/**
 * The one place a model is set up (D-496): paste an Anthropic or OpenRouter key, which keyloom checks and keeps in the system
 * keyring, or sign in with Codex. Chat, the picker, the review and the account failures all lead here. A saved key is used from
 * the next message, with no restart.
 */
export function ModelSetup({ token, status, onChanged, onReload, only, replacing = null }: Props) {
  const waiting = status?.codexSignIn.state === "waiting";
  // A ref, so a parent that passes a new callback each render doesn't restart the poll before it fires.
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetchProviderStatus(token, controller.signal).then((next) => changed.current(next), () => {});
    }, SIGN_IN_POLL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [waiting, token]);

  if (status === null) {
    return (
      <div className="setup-unread" role="alert">
        <p>keyloom couldn't read which models are set up.</p>
        <button type="button" className="button" onClick={onReload}>
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }
  const shown = status.providers.filter((p) => only === undefined || only.includes(p.id));
  return (
    <ul className="setup-providers" aria-label="Ways to set up a model">
      {shown.map((provider) => (
        <ProviderSetup key={provider.id} token={token} provider={provider} status={status} onChanged={onChanged} onReload={onReload} replacing={replacing === provider.id} />
      ))}
    </ul>
  );
}
