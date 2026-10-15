import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Markdown } from "../../src/web/chat/Markdown.tsx";
import { parseInline, parseMarkdown } from "../../src/web/chat/markdown.ts";

describe("parseMarkdown", () => {
  test("paragraphs split on blank lines and join wrapped lines", () => {
    expect(parseMarkdown("one\ntwo\n\nthree")).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "one two" }] },
      { kind: "paragraph", inlines: [{ kind: "text", text: "three" }] },
    ]);
  });

  test("bullet and numbered lists, and a list ends where a paragraph begins", () => {
    const blocks = parseMarkdown("Intro\n- a\n- b\n1. c\n2. d\nAfter");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list", "list", "paragraph"]);
    expect(blocks[1]).toMatchObject({ ordered: false });
    expect(blocks[1]).toMatchObject({ items: [[{ text: "a" }], [{ text: "b" }]] });
    expect(blocks[2]).toMatchObject({ ordered: true });
  });

  test("inline code and bold, and an unclosed marker stays literal while a reply is still streaming", () => {
    expect(parseInline("use `LALT` and **both** keys")).toEqual([
      { kind: "text", text: "use " },
      { kind: "code", text: "LALT" },
      { kind: "text", text: " and " },
      { kind: "bold", text: "both" },
      { kind: "text", text: " keys" },
    ]);
    expect(parseInline("half **bold")).toEqual([{ kind: "text", text: "half **bold" }]);
    expect(parseInline("half `code")).toEqual([{ kind: "text", text: "half `code" }]);
  });

  test("a lone star in a sum is not a list or emphasis", () => {
    expect(parseMarkdown("2 * 3 = 6")).toEqual([{ kind: "paragraph", inlines: [{ kind: "text", text: "2 * 3 = 6" }] }]);
  });
});

describe("Markdown", () => {
  test("model text never becomes markup", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { source: '<img src=x onerror=alert(1)> **ok** `<script>alert(1)</script>`\n\n- <b>x</b>' }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("<strong>ok</strong>");
    expect(html).toContain("<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>");
  });
});
