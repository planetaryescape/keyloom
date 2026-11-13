// R9-03: a Stop that fails is its own problem, "keyloom couldn't stop the reply", with Stop again while the reply runs. It is never "That
// message didn't go through", and never a Try again that sends the box's draft.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError, UNREACHABLE } from "../../src/web/api.ts";
import { ProblemNotice } from "../../src/web/chat/ChatStates.tsx";
import { stopProblem } from "../../src/web/chat/useChat.ts";
import { INTERNAL_WORDS, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";

const setup = { token: "t", status: null, onChanged: () => {}, onReload: () => {} };
const render = (error: unknown, onStop?: () => void) => renderToStaticMarkup(
  <ProblemNotice problem={stopProblem(error)} setup={setup} retry={{ pinned: null, onRetry: () => {} }} onStop={onStop} onDismiss={() => {}} />,
);

test("a failed Stop says keyloom couldn't stop the reply, with Stop again and no Try again", () => {
  const html = render(new ApiError(0, UNREACHABLE), () => {});
  expect(html).toContain("keyloom couldn&#x27;t stop the reply");
  expect(html).toContain("Stop again");
  expect(html).not.toContain("Try again");
  expect(html).not.toContain("didn&#x27;t go through");
});

test("an exception gets Stop again, Restart keyloom and the log's way", () => {
  const html = render(new ApiError(500, INTERNAL_WORDS, { code: "internal" }), () => {});
  expect(html).toContain("Stop again");
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain("Try again");
});

test("an answer that fails the same way every time gets Restart keyloom alone", () => {
  const html = render(new ApiError(400, UNREADABLE_WORDS, { code: "unreadable" }), () => {});
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain("Stop again");
});

test("once the reply has ended there is nothing to stop, so no button sends the draft", () => {
  const html = render(new ApiError(0, UNREACHABLE));
  expect(html).not.toContain("Stop again");
  expect(html).not.toContain("Try again");
});
