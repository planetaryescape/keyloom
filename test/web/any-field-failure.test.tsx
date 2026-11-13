// R10-07: the keycode field keeps a failed read's code and offers a way on: Try again for a lost connection (and never "reconnects by
// itself", which this field doesn't), Try again with Restart keyloom for an exception, Restart keyloom alone for an answer that fails the
// same way every time.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError, UNREACHABLE } from "../../src/web/api.ts";
import { FIELD_UNREACHABLE, readFailure } from "../../src/web/panel/AnyField.tsx";
import { RetryOrRestart } from "../../src/web/shell/UnexpectedWayOut.tsx";
import { INTERNAL_WORDS, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";

const buttons = (error: unknown) => renderToStaticMarkup(<RetryOrRestart token="t" failure={readFailure(error)} onRetry={() => {}} />);

test("a lost connection says to try again once keyloom is back, with Try again", () => {
  const failure = readFailure(new ApiError(0, UNREACHABLE, { code: "unreachable" }));
  expect(failure.message).toBe(FIELD_UNREACHABLE);
  expect(failure.message).not.toContain("by itself");
  const html = buttons(new ApiError(0, UNREACHABLE, { code: "unreachable" }));
  expect(html).toContain("Try again");
  expect(html).not.toContain("Restart keyloom");
});

test("an exception keeps its code: Try again and Restart keyloom", () => {
  const html = buttons(new ApiError(500, INTERNAL_WORDS, { code: "internal" }));
  expect(html).toContain("Try again");
  expect(html).toContain("Restart keyloom");
});

test("an unreadable answer gets Restart keyloom alone", () => {
  const html = buttons(new ApiError(400, UNREADABLE_WORDS, { code: "unreadable" }));
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain("Try again");
});
