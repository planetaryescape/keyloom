// R8-13: a draft checked against a head that has moved on says the page is showing the latest version, with the D-524 button for when
// the re-read never comes, and never the CLI's "propose the change again against the head".
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Layout } from "../../src/layout/schema.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { Validation } from "../../src/web/editor/Validation.tsx";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const layout: Layout = (await importOryxSource(FIXTURE_DIR, (await moonlander()).definition)).layout;
const stale = {
  ok: false, warnings: [], diff: { changed: [], displaced: [], dropped: [], relearnCount: 0, retuned: [], reminders: [] },
  errors: [{ code: "stale_base", message: "the layout changed since rev_1 at Base 6; propose the change again against the head", plain: "This layout changed. Showing the latest version…" }],
};
const render = (onShowLatest?: () => void) =>
  renderToStaticMarkup(createElement(Validation, { layout, idleNote: "", state: { status: "done", result: stale }, onRecheck: () => {}, ...(onShowLatest === undefined ? {} : { onShowLatest }) }));

test("a stale check says the latest version is coming, with Show the latest version, never the CLI sentence", () => {
  const html = render(() => {});
  expect(html).toContain("This layout changed. Showing the latest version…");
  expect(html).toContain("Show the latest version");
  expect(html).not.toContain("propose the change again");
});

test("a pane with no way to read the layout again still shows the plain sentence", () => {
  const html = render();
  expect(html).toContain("This layout changed. Showing the latest version…");
  expect(html).not.toContain("Show the latest version<");
});
