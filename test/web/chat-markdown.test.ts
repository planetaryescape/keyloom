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

describe("typed references in a reply (D-468)", () => {
  test("a marker is a reference inline, at the start, the end and in the middle of a paragraph", () => {
    expect(parseInline("{layer:base} holds it")).toEqual([
      { kind: "reference", reference: { kind: "layer", layerId: "base" } },
      { kind: "text", text: " holds it" },
    ]);
    expect(parseInline("it lands on {key:base:60}")).toEqual([
      { kind: "text", text: "it lands on " },
      { kind: "reference", reference: { kind: "key", layerId: "base", position: 60 } },
    ]);
    expect(parseInline("{config:lay_a} and {proposal:cs_b}")).toEqual([
      { kind: "reference", reference: { kind: "config", id: "lay_a" } },
      { kind: "text", text: " and " },
      { kind: "reference", reference: { kind: "proposal", id: "cs_b" } },
    ]);
    // A list item holds one too.
    expect(parseMarkdown("- moved to {layer:nav}").at(0)).toMatchObject({ kind: "list", items: [[{ kind: "text", text: "moved to " }, { kind: "reference" }]] });
  });

  test("inside inline code a marker stays literal, and so does a brace that never closes", () => {
    expect(parseInline("`{layer:base}`")).toEqual([{ kind: "code", text: "{layer:base}" }]);
    expect(parseInline("run `keyloom config use {config:lay_a}`")).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "keyloom config use {config:lay_a}" },
    ]);
    expect(parseInline("half {layer:base")).toEqual([{ kind: "text", text: "half {layer:base" }]);
    expect(parseInline("{} {layer: base} {screen:history}")).toEqual([{ kind: "text", text: "{} {layer: base} {screen:history}" }]);
  });

  test("bold that holds a marker keeps both: the emphasis and the reference", () => {
    expect(parseInline("**on {layer:base} now**")).toEqual([
      { kind: "bold", text: "on " },
      { kind: "reference", reference: { kind: "layer", layerId: "base" } },
      { kind: "bold", text: " now" },
    ]);
    expect(parseInline("**bold** and {layer:base}")).toEqual([
      { kind: "bold", text: "bold" },
      { kind: "text", text: " and " },
      { kind: "reference", reference: { kind: "layer", layerId: "base" } },
    ]);
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

  test("a numbered list split by bullets keeps counting from its own first number", () => {
    const blocks = parseMarkdown("1. **On the thumb.** Key 60.\n- Moves: ^Left\n2. **On F16.** Key 7.\n- Moves: nothing");
    expect(blocks.map((b) => (b.kind === "list" ? [b.ordered, b.start ?? 1] : b.kind))).toEqual([[true, 1], [false, 1], [true, 2], [false, 1]]);
    expect(blocks[0]).not.toHaveProperty("start");
  });

  test("a reference is a button the page decides on, never an anchor, and the model's text stays text", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      source: "I saved it on {config:lay_a} and moved {key:base:60}\n\n<script>alert(1)</script>",
      reference: (reference) => reference.kind === "config"
        ? { kind: "chip", reference, label: "Glove80 copy", title: "Open Glove80 copy", onActivate: () => {} }
        : { kind: "words", text: "key 61 on Base" },
    }));
    expect(html).toContain('<button type="button" class="ref-chip" data-kind="config" title="Open Glove80 copy">Glove80 copy</button>');
    expect(html).toContain("key 61 on Base");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href");
    // The marker itself never reaches the page for a reference the page can draw, and the script never becomes markup.
    expect(html).not.toContain("{config:lay_a}");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("without a way to draw references a marker reads as the text it is, which is what an older client shows", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { source: "on {layer:base}" }));
    expect(html).toContain("on {layer:base}");
    expect(html).not.toContain("<button");
  });
});
