import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiConfig, NewConfigRequest, VersionHistoryResponse } from "../../api/configs.ts";
import { versionTitle, versionWhen } from "../history/version-words.ts";
import { fetchVersions } from "./api-configs.ts";
import { newConfigWaits, renameWaits } from "./dialog-words.ts";
import { RestoreKeyboard, keyboardRemoved } from "../keyboards/RestoreKeyboard.tsx";
import { restoreKeyboard } from "../keyboards/api-keyboards.ts";
import { FailureNote, RetryOrRestart, UnexpectedWayOut } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, failsAgain, pageFailure, wayOutFor } from "../shell/unexpected.ts";
import "./configs.css";

// The whole failure, not its message alone (R9-05): its code picks Restart keyloom, and the log for an exception (D-540).
const failureOf = (error: unknown): PageFailure => pageFailure(error, "That didn't work.");

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
 * A failure the dialog can say in words with the button that fixes it, such as a refused put-on (R3-01). `extraFixes`: the dialog's
 * `extra`, such as kanata's setup checklist, is the way past this refusal.
 */
export type ConfirmProblem = {
  message: string; detail?: string; action?: { label: string; run: () => void }; extraFixes?: boolean;
  /** A failure no refusal mapping knew, kept whole, so its code picks Restart keyloom (R9-05). */
  failure?: PageFailure;
};

/**
 * A refusal's detail, unless `extra` is up and is the way past this refusal (R5-14): a detail like "The keyboard's status lists what is
 * missing" would point at a page the dialog doesn't open. Any other refusal keeps its words while `extra` shows, such as busy (#293 review).
 */
export const shownDetail = (problem: ConfirmProblem, extraShown: boolean): string | undefined =>
  extraShown && problem.extraFixes === true ? undefined : problem.detail;

/**
 * A yes-or-no with consequences in words: putting a config on the keyboard, and putting a version on it (D-315). The work happens in
 * `onConfirm`; the dialog stays open with the reason if it fails. `problemFor` turns a failure into words and a way on; the button
 * closes the dialog and does it. Without one, or when it returns null, the error's own message is shown.
 */
export function ConfirmDialog({ token, title, lines, confirmLabel, onConfirm, onClose, problemFor, extra, blocked = false }: {
  /** For Restart keyloom beside a failure no refusal mapping knew (R9-05). Without it the sentence shows alone. */
  token?: string | undefined;
  title: string;
  lines: readonly string[];
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  problemFor?: (error: unknown) => ConfirmProblem | null;
  /** Shown under the lines, such as kanata's setup checklist while the confirm can't work yet (R4 residual 1). */
  extra?: ReactNode;
  /** The confirm would be refused now, so it is hidden; `extra` says why and how to get past it. A change clears an earlier refusal. */
  blocked?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ConfirmProblem | null>(null);
  // A refusal belongs to the state it was refused in: once that changes (kanata started), the confirm is offered again without it.
  useEffect(() => setProblem(null), [blocked]);
  const go = async () => {
    // Enter in the dialog submits it too; a hidden confirm must not run that way.
    if (blocked) return;
    setBusy(true);
    setProblem(null);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      const failure = failureOf(error);
      setProblem(problemFor?.(error) ?? { message: failure.message, failure });
      setBusy(false);
    }
  };
  const action = problem?.action;
  // An answer that fails the same way every time takes the confirm away; Restart keyloom beside the sentence is the way on (R9-05).
  // Without a token there is no Restart keyloom, so the confirm stays as the only button.
  const stuck = token !== undefined && failsAgain(problem?.failure);
  return (
    <ConfigDialog
      title={title}
      label={title}
      onClose={onClose}
      onSubmit={() => void go()}
      foot={
        <>
          <button type="button" className="sheet-action" onClick={onClose}>Not now</button>
          {blocked || stuck ? null : action === undefined ? (
            <button type="submit" className="bar-apply" disabled={busy} data-autofocus>
              {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
              {confirmLabel}
            </button>
          ) : (
            // A refusal with a fix: the fix replaces the confirm, which would be refused the same way again.
            <button type="button" className="bar-apply" onClick={() => { onClose(); action.run(); }}>{action.label}</button>
          )}
        </>
      }
    >
      {lines.map((line) => <p key={line} className="config-dialog-lead">{line}</p>)}
      {extra}
      {problem === null ? null : <ConfirmProblemNote token={token} problem={problem} extraShown={extra != null} />}
    </ConfigDialog>
  );
}

/**
 * A refused confirm's words: the sentence, its detail, and for a failure no refusal mapping knew, Restart keyloom and the log (R9-05).
 * Restart keyloom is the primary button when the confirm is gone because it would fail the same way again.
 */
export function ConfirmProblemNote({ token, problem, extraShown }: { token: string | undefined; problem: ConfirmProblem; extraShown: boolean }) {
  return (
    <div className="config-problem" role="alert">
      <p>{problem.message}</p>
      {shownDetail(problem, extraShown) === undefined ? null : <p className="config-problem-detail">{problem.detail}</p>}
      {token === undefined || problem.failure === undefined ? null : (
        <div className="unexpected-actions"><UnexpectedWayOut token={token} failure={problem.failure} primary={failsAgain(problem.failure)} /></div>
      )}
    </div>
  );
}

export function RenameDialog({ token, current, onRename, onClose }: { token?: string | undefined; current: string; onRename: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PageFailure | null>(null);
  const waits = renameWaits(name, current);
  const stuck = token !== undefined && failsAgain(problem);
  const go = async () => {
    if (waits !== null || stuck) return;
    setBusy(true);
    try {
      await onRename(name.trim());
      onClose();
    } catch (error) {
      setProblem(failureOf(error));
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
          <button type="submit" className="bar-apply" disabled={busy || waits !== null || stuck}>Rename</button>
        </>
      }
    >
      <label className="config-label" htmlFor="config-rename">Name</label>
      <input id="config-rename" className="config-input" value={name} data-autofocus aria-describedby="config-rename-waits" onChange={(e) => setName(e.target.value)} />
      <p id="config-rename-waits" className="config-waits">{waits}</p>
      {problem === null ? null : <FailureNote token={token} failure={problem} className="config-problem" primary={stuck} />}
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
  // A failed version list is said, with Try again, instead of hiding the choice as if there were no versions (R3-23). Its code picks
  // Restart keyloom for an answer that fails the same way every time (R9-05).
  const [versionsFailed, setVersionsFailed] = useState<PageFailure | null>(null);
  const [versionReads, setVersionReads] = useState(0);
  const [version, setVersion] = useState<string>(initialVersion ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PageFailure | null>(null);
  const stuck = token !== undefined && failsAgain(problem);
  // The keyboard was removed, so no config can be made for it until it is restored (R6-08).
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setVersionsFailed(null);
    fetchVersions(token, source.id, controller.signal).then((r) => {
      setVersions(r.versions);
      setVersion((v) => (v !== "" ? v : (r.versions[0]?.version.id ?? "")));
    }, (error: unknown) => {
      if (!controller.signal.aborted) setVersionsFailed(pageFailure(error, ""));
    });
    return () => controller.abort();
  }, [token, source.id, versionReads]);

  const now = Date.now();
  const go = async () => {
    if (start === "file") {
      onClose();
      onImport();
      return;
    }
    setBusy(true);
    setProblem(null);
    setRemoved(false);
    const request: NewConfigRequest =
      start === "blank" ? { from: "blank", name, board: boardId }
      : start === "version" ? { from: "config", name, config: source.id, version }
      : { from: "config", name, config: source.id };
    try {
      await onCreate(request);
      onClose();
    } catch (error) {
      if (keyboardRemoved(error)) setRemoved(true);
      else setProblem(failureOf(error));
      setBusy(false);
    }
  };
  const waits = newConfigWaits(start, name, version);
  const ready = waits === null;
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
          <button type="submit" className="bar-apply" disabled={busy || !ready || (stuck && start !== "file")}>
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
          <input id="config-name" className="config-input" value={name} data-autofocus placeholder="Colemak" aria-describedby="config-name-waits" onChange={(e) => setName(e.target.value)} />
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
        {versionsFailed === null ? null : (
          <div className="config-problem" role="alert">
            {/* The page's own sentence says why only for a failure no screen planned for, which Restart keyloom answers. */}
            <p>keyloom couldn't read {source.name}'s versions.{wayOutFor(versionsFailed, true) === null ? "" : ` ${versionsFailed.message}`}</p>
            <div className="unexpected-actions">
              <RetryOrRestart token={token} failure={versionsFailed} onRetry={() => setVersionReads((n) => n + 1)} className="sheet-action" />
            </div>
          </div>
        )}
        {choice("blank", "Blank", "The keyboard's own default keymap where keyloom can get it, otherwise one empty layer")}
        {choice("file", "A file", "Oryx, QMK keymap.c or ZMK .keymap")}
      </fieldset>
      <p id="config-name-waits" className="config-waits">{waits}</p>
      {removed ? <RestoreKeyboard token={token} restore={() => restoreKeyboard(token, boardId)} boardName={boardName} doing="make this config" onRestored={go} /> : null}
      {problem === null ? null : <FailureNote token={token} failure={problem} className="config-problem" primary={stuck && start !== "file"} />}
    </ConfigDialog>
  );
}

/**
 * Deleting a config for good (D-316): offered only for an archived config, and only after its name is typed, the CLI's guard. The
 * server checks the name too and refuses the config on the keyboard.
 */
export function DeleteConfigDialog({ token, name, onDelete, onClose }: { token?: string | undefined; name: string; onDelete: () => Promise<void>; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PageFailure | null>(null);
  const matches = typed === name;
  const stuck = token !== undefined && failsAgain(problem);
  const go = async () => {
    if (!matches || stuck) return;
    setBusy(true);
    try {
      await onDelete();
      onClose();
    } catch (error) {
      setProblem(failureOf(error));
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
          <button type="submit" className="bar-apply config-danger" disabled={busy || !matches || stuck}>Delete {name}</button>
        </>
      }
    >
      <p className="config-dialog-lead">Its layers, history and versions go with it. Unlike archiving, this can't be undone.</p>
      <label className="config-label" htmlFor="config-delete">Type {name} to delete it</label>
      <input id="config-delete" className="config-input" value={typed} data-autofocus autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
      {problem === null ? null : <FailureNote token={token} failure={problem} className="config-problem" primary={stuck} />}
    </ConfigDialog>
  );
}
