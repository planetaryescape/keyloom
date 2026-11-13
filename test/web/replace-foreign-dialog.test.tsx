// R10-05: kanata's Replace it confirm carries the session token, so a failure no screen planned for shows Restart keyloom and the log,
// and Replace it goes off when pressing it again would fail the same way (D-551's rule, which this dialog was the exception to).
import { expect, test } from "bun:test";
import type { ReactElement } from "react";
import { ConfirmDialog } from "../../src/web/configs/ConfigDialogs.tsx";
import { ReplaceForeignHost } from "../../src/web/sync/SyncStatus.tsx";
import type { SyncApi } from "../../src/web/sync/useSync.ts";

test("the Replace it confirm gets the session token", () => {
  const sync = { token: "session-token", replaceAsk: "lay_1", boards: [], replaceForeign: async () => {}, setReplaceAsk: () => {} } as unknown as SyncApi;
  const host = ReplaceForeignHost({ sync, boardId: "apple/macbook-ansi" }) as ReactElement<Record<string, unknown>>;
  // The dialog holds no state of its own, so calling it shows the confirm it renders.
  const dialog = (host.type as (props: unknown) => ReactElement<{ token?: string; confirmLabel: string }>)(host.props);
  expect(dialog.type).toBe(ConfirmDialog);
  expect(dialog.props).toMatchObject({ token: "session-token", confirmLabel: "Replace it" });
});
