import { CircleAlert, CornerDownLeft, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Binding, Firmware, Layout } from "../../layout/schema.ts";
import { bindingSummary } from "../editor/draft.ts";
import { parseBinding } from "../api-write.ts";
import { ApiError } from "../api.ts";
import { RetryOrRestart } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, pageFailure } from "../shell/unexpected.ts";

interface Props {
  token: string;
  layoutRef: string;
  layout: Layout;
  firmware: Firmware;
  /** The key being edited, so a QMK mod-tap gets the profile for its row. */
  position: number;
  autoFocus: boolean;
  onUse: (binding: Binding) => void;
}

type Reading =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "ok"; binding: Binding; native: boolean; note?: string }
  | { status: "problem"; message: string }
  /** The read itself failed, kept with its code (R10-07). */
  | { status: "failed"; failure: PageFailure };

const EXAMPLE: Record<Firmware, string> = { qmk: "LCTL_T(KC_A)", zmk: "&mt LCTRL A", kanata: "S-a" };
const DEBOUNCE_MS = 250;

/** A request that never reached keyloom. The page's other reads come back by themselves; this field reads again only on Try again. */
export const FIELD_UNREACHABLE = "keyloom stopped answering, so it couldn't read that. Try again once it is back.";

/**
 * A failed read of the typed keycode, kept with its code (R10-07), so the field picks its buttons from it. A lost connection gets its own
 * words, because the shared sentence promises a reconnect this field doesn't make by itself. Pure.
 */
export function readFailure(error: unknown): PageFailure {
  if (error instanceof ApiError && error.status === 0) return { message: FIELD_UNREACHABLE, ...(error.code === undefined ? {} : { code: error.code }) };
  return pageFailure(error, "keyloom couldn't read that.");
}

// The escape hatch that keeps the categories small (D-087): a firmware expression, read by the same
// code an import uses, shown as what it means before it is taken. The reading happens on the server
// because the importers live there.
export function AnyField({ token, layoutRef, layout, firmware, position, autoFocus, onUse }: Props) {
  const [text, setText] = useState("");
  const [reading, setReading] = useState<Reading>({ status: "idle" });
  // Bumped by Try again, so the same text is read again.
  const [reads, setReads] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (text.trim() === "") {
      setReading({ status: "idle" });
      return;
    }
    // Each keystroke supersedes the last: an answer for earlier text must never be taken for this text's.
    const controller = new AbortController();
    setReading({ status: "reading" });
    const timer = window.setTimeout(() => {
      parseBinding(token, layoutRef, { expression: text, position }, controller.signal)
        .then((answer) => {
          if (controller.signal.aborted) return;
          setReading(answer.ok ? { status: "ok", binding: answer.binding, native: answer.native, ...(answer.note === undefined ? {} : { note: answer.note }) } : { status: "problem", message: answer.message });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setReading({ status: "failed", failure: readFailure(error) });
        });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [text, token, layoutRef, position, reads]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    // Stops the panel's own Enter, which applies: this Enter only takes the reading.
    event.stopPropagation();
    if (reading.status === "ok") onUse(reading.binding);
  }

  return (
    <div className="any">
      <label htmlFor={id} className="any-label">
        {firmware === "qmk" ? "A QMK keycode" : firmware === "zmk" ? "A ZMK binding" : "A kanata key"}
      </label>
      <input
        ref={input}
        id={id}
        type="text"
        className="any-input"
        autoComplete="off"
        spellCheck={false}
        placeholder={`Try ${EXAMPLE[firmware]}`}
        value={text}
        aria-describedby={`${id}-result`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div id={`${id}-result`} className="any-result" aria-live="polite">
        {reading.status === "idle" ? (
          <p className="muted">Type a keycode as the firmware writes it. keyloom shows what it reads before it is used.</p>
        ) : reading.status === "reading" ? (
          <p className="muted"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Reading</p>
        ) : reading.status === "problem" ? (
          <p className="any-problem"><CircleAlert size={14} aria-hidden="true" /> {reading.message}</p>
        ) : reading.status === "failed" ? (
          <>
            <p className="any-problem"><CircleAlert size={14} aria-hidden="true" /> {reading.failure.message}</p>
            <div className="unexpected-actions"><RetryOrRestart token={token} failure={reading.failure} onRetry={() => setReads((n) => n + 1)} /></div>
          </>
        ) : (
          <>
            <p className="any-reads">
              <span className="any-reads-label">{reading.native ? "Kept as written" : "Reads as"}</span>
              <strong>{bindingSummary(reading.binding, layout)}</strong>
            </p>
            {reading.native ? <p className="muted">keyloom doesn&apos;t model this one, so it is passed to the firmware as you typed it and can&apos;t be edited in parts.</p> : null}
            {reading.note === undefined ? null : <p className="muted">{reading.note}</p>}
            <button type="button" className="button" onClick={() => onUse(reading.binding)}>
              Use this <CornerDownLeft size={14} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
