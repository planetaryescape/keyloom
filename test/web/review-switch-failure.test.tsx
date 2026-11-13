// R10-07: the review's provider switch keeps a failure's code, so an answer that fails the same way every time offers Restart keyloom,
// never Try again alone.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError, UNREACHABLE } from "../../src/web/api.ts";
import { switchFailure } from "../../src/web/review/review-words.ts";
import { RetryOrRestart } from "../../src/web/shell/UnexpectedWayOut.tsx";
import { INTERNAL_WORDS, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";

const buttons = (error: unknown) => renderToStaticMarkup(<RetryOrRestart token="t" failure={switchFailure("Codex", error)} onRetry={() => {}} />);

test("the words lead with the switch and keep the failure's sentence", () => {
  expect(switchFailure("Codex", new ApiError(0, UNREACHABLE, { code: "unreachable" })).message).toBe(`keyloom couldn't switch to Codex. ${UNREACHABLE}`);
  expect(switchFailure("Codex", new Error("")).message).toBe("keyloom couldn't switch to Codex.");
  expect(switchFailure("Codex", new ApiError(500, INTERNAL_WORDS, { code: "internal" })).code).toBe("internal");
});

test("a lost connection gets Try again; an unreadable answer gets Restart keyloom alone; an exception gets both", () => {
  expect(buttons(new ApiError(0, UNREACHABLE, { code: "unreachable" }))).toContain("Try again");
  const unreadable = buttons(new ApiError(400, UNREADABLE_WORDS, { code: "unreadable" }));
  expect(unreadable).toContain("Restart keyloom");
  expect(unreadable).not.toContain("Try again");
  const internal = buttons(new ApiError(500, INTERNAL_WORDS, { code: "internal" }));
  expect(internal).toContain("Try again");
  expect(internal).toContain("Restart keyloom");
});
