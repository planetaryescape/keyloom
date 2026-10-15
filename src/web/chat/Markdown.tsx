import { Fragment } from "react";
import { parseMarkdown, type Inline } from "./markdown.ts";

function Inlines({ inlines }: { inlines: readonly Inline[] }) {
  return (
    <>
      {inlines.map((inline, index) => (
        <Fragment key={index}>
          {inline.kind === "code" ? <code>{inline.text}</code> : inline.kind === "bold" ? <strong>{inline.text}</strong> : inline.text}
        </Fragment>
      ))}
    </>
  );
}

// Builds React elements from parsed blocks, so text is always a text node and never HTML.
export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose">
      {parseMarkdown(source).map((block, index) => {
        if (block.kind === "paragraph") {
          return (
            <p key={index}>
              <Inlines inlines={block.inlines} />
            </p>
          );
        }
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} {...(block.start === undefined ? {} : { start: block.start })}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inlines inlines={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
