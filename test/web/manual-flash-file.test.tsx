import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../../src/web/api.ts";
import { ManualFlash } from "../../src/web/release/FlashPrerequisites.tsx";
import { fileProblem } from "../../src/web/release/flash-words.ts";

const GONE = "This build has no firmware file. Build it again.";

test("a build whose firmware file is gone keeps the server's words and is marked gone; any other failure is not (#301 review)", () => {
  expect(fileProblem(new ApiError(404, GONE, { code: "not_found" }), "fallback")).toEqual({ text: GONE, gone: true });
  expect(fileProblem(new ApiError(500, "keyloom hit a problem.", { code: "internal" }), "fallback")).toEqual({ text: "keyloom hit a problem.", gone: false });
  expect(fileProblem("odd", "The file couldn't be downloaded.")).toEqual({ text: "The file couldn't be downloaded.", gone: false });
});

const view = { kind: "manual" as const, instructions: "Double-tap reset, then copy the file to the drive.", canReveal: true };
const render = (problem: { text: string; gone: boolean } | null) =>
  renderToStaticMarkup(<ManualFlash view={view} boardName="Corne" onDownload={() => {}} onReveal={() => {}} onBuildAgain={() => {}} problem={problem} />);

test("the manual flash step offers Build again when the file is gone, and no restart", () => {
  const html = render({ text: GONE, gone: true });
  expect(html).toContain(GONE);
  expect(html).toContain("Build again");
  expect(html).not.toMatch(/Restart keyloom|newer than/);
});

test("a download that failed for another reason shows its words without Build again", () => {
  expect(render({ text: "keyloom stopped answering.", gone: false })).not.toContain("Build again");
});
