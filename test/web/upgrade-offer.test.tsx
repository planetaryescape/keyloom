// R9-09: Update layout that keyloom's check turned down says so in plain words, and the button gives way to Hide this, because the check
// runs on the same layout every time and pressing it again is refused the same way.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../../src/web/api.ts";
import { UpgradeOffer } from "../../src/web/settings/UpgradeOffer.tsx";
import { UPGRADE_REFUSED, upgradeFailure } from "../../src/web/settings/upgrade-words.ts";
import { INTERNAL_WORDS } from "../../src/web/shell/unexpected.ts";

const render = (refused: boolean) => renderToStaticMarkup(
  <UpgradeOffer offer={{ colours: true, tapDances: true }} onUpgrade={async () => {}} token="t" refused={refused} onRefused={() => {}} onHide={() => {}} />,
);

test("the check's refusal is a refusal, by its code, never by the server's sentence", () => {
  expect(upgradeFailure(new ApiError(409, "the upgrade was not saved: the upgraded layout doesn't parse", { code: "validation_failed" }))).toEqual({ kind: "refused" });
  expect(upgradeFailure(new ApiError(500, INTERNAL_WORDS, { code: "internal" }))).toEqual({ kind: "failed", message: INTERNAL_WORDS, code: "internal" });
});

test("a refused update shows plain words and Hide this, never Update layout again", () => {
  const html = render(true);
  expect(html).toContain(UPGRADE_REFUSED.replace(/'/g, "&#x27;"));
  expect(html).toContain("Hide this");
  expect(html).not.toContain("Update layout</button>");
  expect(html).not.toContain("the upgrade was not saved");
});

test("the offer keeps Update layout until the check turns it down", () => {
  const html = render(false);
  expect(html).toContain("Update layout");
  expect(html).not.toContain("Hide this");
});
