// A comparison that failed to load says why and offers Try again, which compares again (R1-21).
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VersionCompare } from "../../src/web/history/VersionCompare.tsx";

test("a failed comparison shows its reason with Try again", () => {
  const milestone = { version: { id: "ver_1", revisionId: "rev_1", name: "Before", putOnAt: 1, endedAt: 2, current: false, summary: "s", createdAt: 1 }, revisions: [] };
  const html = renderToStaticMarkup(
    <VersionCompare
      comparing={{ milestone, status: "error", message: "keyloom stopped answering." }}
      layout={{ layers: [], macros: [], tapDances: [], passthrough: null } as never}
      boardName="Glove80" layerId="base" layerName={(id) => id}
      onBack={() => {}} onClose={() => {}} onShowLayer={() => {}} onGoBack={() => {}} onPutOn={() => {}} onNewConfig={() => {}} onRetry={() => {}}
      blockedReason={null}
    />,
  );
  expect(html).toContain("keyloom stopped answering.");
  expect(html).toContain("Try again");
});
