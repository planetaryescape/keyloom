import { Fragment } from "react";
import { markerText, type Reference } from "../../layout/references.ts";
import { parseMarkdown, type Inline } from "./markdown.ts";
import type { ReferenceView } from "./reference-view.ts";

/** How the page draws a reference a reply named; without one, the marker reads as the text it is. */
export type DrawReference = (reference: Reference) => ReferenceView;

function ReferenceChip({ view }: { view: Extract<ReferenceView, { kind: "chip" }> }) {
  return (
    <button type="button" className="ref-chip" data-kind={view.reference.kind} title={view.title} onClick={view.onActivate}>
      {view.label}
    </button>
  );
}

// A button that goes to what the reply named, or the words it stands for. Never an anchor and never HTML: the marker carries an id
// and the page decides where it goes (D-404, D-468).
function DrawnReference({ reference, draw }: { reference: Reference; draw?: DrawReference }) {
  if (draw === undefined) return <>{markerText(reference)}</>;
  const view = draw(reference);
  return view.kind === "chip" ? <ReferenceChip view={view} /> : <>{view.text}</>;
}

function Inlines({ inlines, draw }: { inlines: readonly Inline[]; draw?: DrawReference }) {
  return (
    <>
      {inlines.map((inline, index) => (
        <Fragment key={index}>
          {inline.kind === "code" ? <code>{inline.text}</code>
            : inline.kind === "bold" ? <strong>{inline.text}</strong>
              : inline.kind === "reference" ? <DrawnReference reference={inline.reference} {...(draw === undefined ? {} : { draw })} />
                : inline.text}
        </Fragment>
      ))}
    </>
  );
}

// Builds React elements from parsed blocks, so text is always a text node and never markup.
export function Markdown({ source, reference }: { source: string; reference?: DrawReference }) {
  const draw = reference === undefined ? {} : { draw: reference };
  return (
    <div className="prose">
      {parseMarkdown(source).map((block, index) => {
        if (block.kind === "paragraph") {
          return (
            <p key={index}>
              <Inlines inlines={block.inlines} {...draw} />
            </p>
          );
        }
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} {...(block.start === undefined ? {} : { start: block.start })}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inlines inlines={item} {...draw} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
