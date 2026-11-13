import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelSetup, SETUP_READING_WORDS, SETUP_UNREAD_WORDS } from "../../src/web/chat/ModelSetup.tsx";

const props = { token: "t", status: null, onChanged: () => {}, onReload: () => {} };

test("Set up a model pressed while the status is still being read waits for it, never with the failure words (R8-16)", () => {
  const html = renderToStaticMarkup(<ModelSetup {...props} reading />);
  expect(html).toContain("keyloom is still reading which models are set up.");
  expect(html).toContain('role="status"');
  expect(html).not.toContain(SETUP_UNREAD_WORDS.replace("'", "&#x27;"));
  expect(html).not.toContain("Try again");
});

test("a status read that ended without an answer says so, with Try again", () => {
  const html = renderToStaticMarkup(<ModelSetup {...props} reading={false} />);
  expect(html).toContain("keyloom couldn&#x27;t read which models are set up.");
  expect(html).toContain("Try again");
  expect(SETUP_READING_WORDS).not.toContain("couldn't");
});
