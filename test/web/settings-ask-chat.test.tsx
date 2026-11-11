// The read-only settings name the chat as the way to change one, and the name is a button that opens it (R1-23).
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Layout } from "../../src/layout/schema.ts";
import { OtherSettings } from "../../src/web/settings/SettingsPane.tsx";

const layout = { passthrough: [] } as unknown as Layout;
const settings = [{ key: "TAPPING_TERM", value: 180 }] as unknown as Layout["settings"];

test("Ask the chat is a button, not words", () => {
  const html = renderToStaticMarkup(<OtherSettings layout={layout} settings={settings} />);
  expect(html).toMatch(/<button[^>]*>Ask the chat<\/button> to change one/);
});
