import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiConfig, NewConfigRequest, VersionHistoryResponse } from "../../api/configs.ts";
import { ApiError } from "../api.ts";
import { versionTitle, versionWhen } from "../history/version-words.ts";
import { fetchVersions } from "./api-configs.ts";
import "./configs.css";

const message = (error: unknown) => (error instanceof ApiError || error instanceof Error ? error.message : "That didn't work.");

/** A modal with a title, its body and a foot; Escape and a click outside close it, as the layer dialogs do. */
function ConfigDialog({ title, label, onClose, children, foot, onSubmit }: {
  title: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
  foot: ReactNode;
  onSubmit?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element === null || element.open) return;
    element.showModal();
    // showModal focuses the first control, the close button; the dialog's own choice (its action, or the field to type in) wins.
    element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };
  return (
    <dialog ref={dialog} className="config-dialog" aria-label={label} onClose={onClose} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={submit}>
        <header className="config-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </header>
        {children}
        <footer className="config-dialog-foot">{foot}</footer>
      </form>
    </dialog>
  );
}

/**
 * A yes-or-no with consequences in words: putting a config on the keyboard, and putting a version on it (D-315). The work happens in
 * `onConfirm`; the dialog stays open with the reason if it fails.
 */
export function ConfirmDialog({ title, lines, confirmLabel, onConfirm, onClose }: {
  title: string;
  lines: readonly string[];
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      setProblem(message(error));
      setBusy(false);
    }
  };
  return (
    <ConfigDialog
      title={title}
      label={title}
      onClose={onClose}
      onSubmit={() => void go()}
      foot={
        <>
          <button type="button" className="sheet-action" onClick={onClose}>Not now</button>
          <button type="submit" className="bar-apply" disabled={busy} data-autofocus>
            {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      {lines.map((line) => <p key={line} className="config-dialog-lead">{line}</p>)}
      {problem === null ? null : <p className="config-problem" role="alert">{problem}</p>}
    </ConfigDialog>
  );
}

export function RenameDialog({ current, onRename, onClose }: { current: string; onRename: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async () => {
    if (name.trim() === "" || name.trim() === current) return;
    setBusy(true);
    try {
      await onRename(name.trim());
      onClose();
    } catch (error) {
      setProblem(message(error));
      setBusy(false);
    }
  };
  return (
    <ConfigDialog
      title={`Rename ${current}`}
      label="Rename the config"
      onClose={onClose}
      onSubmit={() => void go()}
      foot={
        <>
          <button type="button" className="sheet-action" onClick={onClose}>Cancel</button>
          <button type="submit" className="bar-apply" disabled={busy || name.trim() === "" || name.trim() === current}>Rename</button>
        </>
      }
    >
      <label className="config-label" htmlFor="config-rename">Name</label>
      <input id="config-rename" className="config-input" value={name} data-autofocus onChange={(e) => setName(e.target.value)} />
      {problem === null ? null : <p className="config-problem" role="alert">{problem}</p>}
    </ConfigDialog>
  );
}

type Start = "copy" | "version" | "blank" | "file";
type Versions = VersionHistoryResponse["versions"];

/**
 * A new config (c4, D-315): a name, then where it starts. "Blank" is the board's firmware default keymap where keyloom can read one,
 * else one empty layer sized to the board (D-370); the History entry says which. "A file" hands over to the import screen, which posts the
 * file to /api/import, the same importers the new-config route's `from: "import"` runs (D-371). It never goes on the keyboard by itself.
 */
export function NewConfigDialog({ token, source, boardId, boardName, start: initialStart = "copy", version: initialVersion, onCreate, onImport, onClose }: {
  token: string;
  /** The config on screen: "as it is now" copies its head; "a version" picks from its versions. */
  source: { id: string; name: string };
  boardId: string;
  boardName: string;
  /** History's "New config from here" opens this on that version. */
  start?: Start;
  version?: string;
  onCreate: (request: NewConfigRequest) => Promise<ApiConfig>;
  onImport: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [start, setStart] = useState<Start>(initialStart);
  const [versions, setVersions] = useState<Versions | null>(null);
  const [version, setVersion] = useState<string>(initialVersion ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchVersions(token, source.id, controller.signal).then((r) => {
      setVersions(r.versions);
      setVersion((v) => (v !== "" ? v : (r.versions[0]?.version.id ?? "")));
    }, () => setVersions([]));
    return () => controller.abort();
  }, [token, source.id]);

  const now = Date.now();
  const go = async () => {
    if (start === "file") {
      onClose();
      onImport();
      return;
    }
    setBusy(true);
    setProblem(null);
    const request: NewConfigRequest =
      start === "blank" ? { from: "blank", name, board: boardId }
      : start === "version" ? { from: "config", name, config: source.id, version }
      : { from: "config", name, config: source.id };
    try {
      await onCreate(request);
      onClose();
    } catch (error) {
      setProblem(message(error));
      setBusy(false);
    }
  };
  const ready = start === "file" || (name.trim() !== "" && (start !== "version" || version !== ""));
  const choice = (id: Start, title: string, detail: string, extra?: ReactNode) => (
    <label className="config-choice" data-on={start === id || undefined}>
      <input type="radio" name="config-start" value={id} checked={start === id} onChange={() => setStart(id)} />
      <span>
        {title}
        <small>{detail}</small>
        {extra}
      </span>
    </label>
  );
  return (
    <ConfigDialog
      title="New config"
      label="New config"
      onClose={onClose}
      onSubmit={() => void go()}
      foot={
        <>
          <button type="button" className="sheet-action" onClick={onClose}>Cancel</button>
          <button type="submit" className="bar-apply" disabled={busy || !ready}>
            {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
            {start === "file" ? "Choose a file…" : name.trim() === "" ? "Make it" : `Make ${name.trim()}`}
          </button>
        </>
      }
    >
      <p className="config-dialog-lead">A config is a whole layout of its own, for a different way of typing. It won't go on your {boardName} until you put it on.</p>
      {start === "file" ? null : (
        <>
          <label className="config-label" htmlFor="config-name">Name</label>
          <input id="config-name" className="config-input" value={name} data-autofocus placeholder="Colemak" onChange={(e) => setName(e.target.value)} />
        </>
      )}
      <fieldset className="config-choices">
        <legend className="config-label">Start from</legend>
        {choice("copy", `${source.name} as it is now`, "Every layer, combo and setting; its history starts here")}
        {versions !== null && versions.length === 0
          ? null
          : choice(
              "version",
              `A version of ${source.name}`,
              `What was on your ${boardName} at a point you pick`,
              start === "version" && versions !== null ? (
                <select className="config-select" aria-label="Which version" value={version} onChange={(e) => setVersion(e.target.value)}>
                  {versions.map(({ version: v }) => <option key={v.id} value={v.id}>{versionTitle(v)} · {versionWhen(v, now)}</option>)}
                </select>
              ) : null,
            )}
        {choice("blank", "Blank", "The keyboard's own default keymap where keyloom can get it, otherwise one empty layer")}
        {choice("file", "A file", "Oryx, QMK keymap.c or ZMK .keymap")}
      </fieldset>
      {problem === null ? null : <p className="config-problem" role="alert">{problem}</p>}
    </ConfigDialog>
  );
}

/**
 * Deleting a config for good (D-316): offered only for an archived config, and only after its name is typed, the CLI's guard. The
 * server checks the name too and refuses the config on the keyboard.
 */
export function DeleteConfigDialog({ name, onDelete, onClose }: { name: string; onDelete: () => Promise<void>; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const matches = typed === name;
  const go = async () => {
    if (!matches) return;
    setBusy(true);
    try {
      await onDelete();
      onClose();
    } catch (error) {
      setProblem(message(error));
      setBusy(false);
    }
  };
  return (
    <ConfigDialog
      title={`Delete ${name} for good?`}
      label="Delete the config"
      onClose={onClose}
      onSubmit={() => void go()}
      foot={
        <>
          <button type="button" className="sheet-action" onClick={onClose}>Cancel</button>
          <button type="submit" className="bar-apply config-danger" disabled={busy || !matches}>Delete {name}</button>
        </>
      }
    >
      <p className="config-dialog-lead">Its layers, history and versions go with it. Unlike archiving, this can't be undone.</p>
      <label className="config-label" htmlFor="config-delete">Type {name} to delete it</label>
      <input id="config-delete" className="config-input" value={typed} data-autofocus autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
      {problem === null ? null : <p className="config-problem" role="alert">{problem}</p>}
    </ConfigDialog>
  );
}
