import { LoaderCircle, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CopyCommand } from "./CopyCommand.tsx";
import { SERVER_GONE_AFTER_MS, initialConnection, inDesktopApp, nextConnection, restartAdvice, serverGone } from "./server-gone.ts";

/**
 * True while the events stream has been down for about three seconds; `onBack` runs once when it returns, so the page can read again
 * what it shows (D-494).
 */
export function useServerGone(live: boolean, onBack: () => void): boolean {
  const [connection, setConnection] = useState(initialConnection);
  const [now, setNow] = useState(() => Date.now());
  const wasGone = useRef(false);
  useEffect(() => {
    setConnection((prev) => nextConnection(prev, live, Date.now()));
  }, [live]);
  useEffect(() => {
    if (connection.downSince === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, connection.downSince + SERVER_GONE_AFTER_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [connection.downSince]);
  const gone = serverGone(connection, Math.max(now, connection.downSince ?? 0));
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    if (gone) wasGone.current = true;
    else if (wasGone.current && connection.downSince === null) {
      wasGone.current = false;
      back.current();
    }
  }, [gone, connection.downSince]);
  return gone;
}

/** One slim line across the top of the page while keyloom is gone; it goes by itself when keyloom answers again. */
export function ServerGoneBanner({ tokenRejected }: { tokenRejected: boolean }) {
  const desktop = inDesktopApp();
  const advice = restartAdvice(desktop);
  return (
    <div className="server-gone" role="status">
      {tokenRejected ? <Unplug size={14} aria-hidden="true" /> : <LoaderCircle size={14} className="spin" aria-hidden="true" />}
      <span className="server-gone-text">
        <strong>{tokenRejected ? "keyloom restarted, so this page's link no longer works." : "keyloom stopped answering. Reconnecting…"}</strong>
        <span>
          {tokenRejected ? (desktop ? " Quit keyloom and open it again." : " Open keyloom again from the app, or open the new link its terminal printed.") : ` If you closed it: ${advice.app}`}
          {!tokenRejected && advice.terminal !== null ? ` ${advice.terminal}` : null}
        </span>
      </span>
      {!tokenRejected && advice.terminal !== null ? <CopyCommand command="keyloom serve" /> : null}
    </div>
  );
}

/** How to get keyloom's link again (R1-22): the desktop app's line only inside it, both lines in a browser. */
export function RestartAdvice({ lead }: { lead: string }) {
  const advice = restartAdvice(inDesktopApp());
  return (
    <>
      {lead} {advice.app}
      {advice.terminal === null ? null : (
        <>
          {" "}{advice.terminal}
          <span className="state-command"><CopyCommand command="keyloom serve" /></span>
        </>
      )}
    </>
  );
}
