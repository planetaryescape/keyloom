// What Update layout says when it doesn't go through (R9-09), by the failure's code only. Pure.
import { type PageFailure, pageFailure } from "../shell/unexpected.ts";

/**
 * The server checks the updated layout before it saves it (D-193), against the same head every time, so a refusal repeats until the
 * layout changes. The colours and tap dances stay in the layout as Oryx code, which goes to the keyboard as it is.
 */
export const UPGRADE_REFUSED = "keyloom can't update this layout: the updated version didn't pass keyloom's checks, so nothing changed. Your Oryx colours and tap dances still go to the keyboard as they are.";

export type UpgradeFailure = { kind: "refused" } | ({ kind: "failed" } & PageFailure);

/** `refused`: the check turned the update down (`validation_failed`), so Update layout gives way to Hide this. Anything else keeps its failure. */
export function upgradeFailure(error: unknown): UpgradeFailure {
  const failure = pageFailure(error, "keyloom couldn't update the layout.");
  return failure.code === "validation_failed" ? { kind: "refused" } : { kind: "failed", ...failure };
}
