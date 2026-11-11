// The read-only settings name the chat as the way to change one, and the name is a button that opens it (R1-23).
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Layout } from "../../src/layout/schema.ts";
import { OtherSettings } from "../../src/web/settings/SettingsPane.tsx";

const settings: Layout["settings"] = [{ firmware: "qmk", key: "TAPPING_TERM", value: 180 }];

test("Ask the chat is a button, not words", () => {
  const html = renderToStaticMarkup(<OtherSettings passthrough={[]} settings={settings} />);
  expect(html).toMatch(/<button[^>]*>Ask the chat<\/button> to change one/);
});
