// Markdown-lite for assistant replies: paragraphs, bullet and numbered lists, `inline code`, **bold**, and the typed references a
// reply may name (`{config:<id>}`, `{proposal:<id>}`, `{layer:<layerId>}`, `{key:<layerId>:<position>}`: D-468). It parses to data and
// the component builds elements from it, so nothing the model writes can become markup. A reference is an id: the component asks the
// page what to draw and gets either a chip that goes there or plain words. Anything else (headings, links, tables, HTML) stays as
// plain text. The reference check runs after inline code, so a marker in backticks stays literal.
import { type Reference, markerAt } from "../../layout/references.ts";

export type Inline =
  | { kind: "text" | "code" | "bold"; text: string }
  | { kind: "reference"; reference: Reference };
export type Block =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][]; start?: number };

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;

// Bold with the references inside it kept as references: "**on {layer:base}**" is bold words, the chip, then bold words again, so a
// reply that emphasises a name still gets a chip for it.
function bold(text: string): Inline[] {
  if (text.includes("{") === false) return [{ kind: "bold", text }];
  const out: Inline[] = [];
  let last = 0;
  for (let i = 0; i < text.length; ) {
    const marker = text[i] === "{" ? markerAt(text, i) : null;
    if (marker === null) {
      i += 1;
      continue;
    }
    if (i > last) out.push({ kind: "bold", text: text.slice(last, i) });
    out.push({ kind: "reference", reference: marker.reference });
    i += marker.length;
    last = i;
  }
  if (last === 0) return [{ kind: "bold", text }];
  if (last < text.length) out.push({ kind: "bold", text: text.slice(last) });
  return out;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") out.push({ kind: "text", text: plain });
    plain = "";
  };
  for (let i = 0; i < text.length; ) {
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push(...bold(text.slice(i + 2, end)));
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "{") {
      const marker = markerAt(text, i);
      if (marker !== null) {
        flush();
        out.push({ kind: "reference", reference: marker.reference });
        i += marker.length;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  flush();
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][]; start?: number } | null = null;

  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const endList = () => {
    if (list !== null) blocks.push({ kind: "list", ...list });
    list = null;
  };

  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    if (line.trim() === "") {
      endParagraph();
      endList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    if (bullet !== null || numbered !== null) {
      endParagraph();
      const ordered = numbered !== null;
      if (list !== null && list.ordered !== ordered) endList();
      // The model often puts bullets between numbered items, which splits the numbered list; each
      // part keeps its first number so the options still read 1, 2, 3.
      const start = numbered === null ? 1 : Number(numbered[1]);
      list ??= start === 1 ? { ordered, items: [] } : { ordered, items: [], start };
      list.items.push(parseInline((numbered === null ? bullet?.[1] : numbered[2]) ?? ""));
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  endParagraph();
  endList();
  return blocks;
}
