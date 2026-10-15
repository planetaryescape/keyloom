// Reading what a stored layout still holds as Oryx code into the model, when BK asks (D-193). Nothing here runs on a read:
// `upgradeOffer` only looks, and `upgradeLayout` is the one action that writes, as a revision that undoes like any change.
import { generateQmkSource } from "../firmware/qmk/generate.ts";
import { type Upgrade, upgradeStoredOryx, upgradeSummary } from "../firmware/qmk/upgrade.ts";
import { LayoutSchema } from "../layout/schema.ts";
import { transact } from "../persistence/transaction.ts";
import { appendRevision } from "../persistence/revisions.ts";
import { documentRules } from "../validation/rules.ts";
import type { App } from "./context.ts";
import { ValidationFailedError } from "./errors.ts";
import { type LayoutView, getLayout } from "./layouts.ts";

export type UpgradeOffer = { colours: boolean; tapDances: boolean };

/** What the head holds as code that keyloom can now edit; null when there is none. */
export function upgradeOffer(view: Pick<LayoutView, "document" | "board">): UpgradeOffer | null {
  const upgrade = upgradeStoredOryx(view.document, view.board.definition);
  return upgrade === null ? null : { colours: upgrade.colours, tapDances: upgrade.tapDances };
}

export type UpgradeOutcome = { changed: false; message: string } | { changed: true; message: string; revisionId: string };

const refuse = (why: string): never => {
  throw new ValidationFailedError(`the upgrade was not saved: ${why}`, { errors: [{ message: why }] });
};

/** Checks the upgraded document the way an applied change is checked: it parses, it breaks no rule the old one kept, and it still generates. */
function check(view: LayoutView, upgrade: Upgrade, revisionId: string): void {
  const board = view.board.definition;
  if (!LayoutSchema.safeParse(upgrade.layout).success) refuse("the upgraded layout doesn't parse");
  const had = new Set(documentRules(board, view.document).map((i) => `${i.code}:${i.message}`));
  const worse = documentRules(board, upgrade.layout).filter((i) => !had.has(`${i.code}:${i.message}`));
  if (worse.length > 0) refuse(worse[0]?.plain ?? worse[0]?.message ?? "it breaks a rule");
  try {
    generateQmkSource({ layout: upgrade.layout, board, revisionId });
  } catch (error) {
    refuse(error instanceof Error ? error.message : "the firmware can't be generated from it");
  }
}

/** Appends one revision that reads the colours and tap dances from the Oryx code. A layout with none left is not written to. */
export function upgradeLayout(app: App, ref: string): UpgradeOutcome {
  return transact(app.db, () => {
    const view = getLayout(app, ref);
    const upgrade = upgradeStoredOryx(view.document, view.board.definition);
    if (upgrade === null) return { changed: false, message: `${view.layout.name} has no Oryx colours or tap dances left to read; nothing was changed.` };
    check(view, upgrade, view.revision.id);
    const summary = upgradeSummary(upgrade);
    const revision = appendRevision(app.db, { layoutId: view.layout.id, expectedHeadId: view.revision.id, layout: upgrade.layout, origin: "editor", summary });
    return { changed: true, message: `${summary}.`, revisionId: revision.id };
  });
}

