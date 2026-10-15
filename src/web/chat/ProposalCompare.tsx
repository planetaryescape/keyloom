import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";
import type { ProposalCard } from "../../api/http.ts";
import type { Layout } from "../../layout/schema.ts";
import { compareRows } from "./compare.ts";
import "./compare.css";

interface Props {
  group: readonly ProposalCard[];
  layout: Layout;
  pinnedId: string | null;
  onPreview: (proposal: ProposalCard | null) => void;
  onPin: (proposal: ProposalCard) => void;
}

// The alternatives side by side before the cards, so the cost of each is one glance and not three
// scrolls (09#proposals). A row previews on hover like its card does, and its title toggles the
// board between alternatives, which is how 09 says comparing works.
export function ProposalCompare({ group, layout, pinnedId, onPreview, onPin }: Props) {
  const rows = compareRows(group, layout);
  return (
    <table className="compare">
      <caption>Compare {rows.length} options</caption>
      <thead>
        <tr>
          <th scope="col">Option</th>
          <th scope="col" className="compare-num" title="Functions that change position">Relearn</th>
          <th scope="col" className="compare-num" title="Things the validator warns about">Warnings</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const proposal = group[index] as ProposalCard;
          const open = row.status === "proposed";
          return (
            <tr
              key={row.changeSetId}
              data-status={row.status}
              data-pinned={pinnedId === row.changeSetId}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse" && open) onPreview(proposal);
              }}
              onPointerLeave={() => onPreview(null)}
            >
              <th scope="row">
                <div className="compare-cell">
                <span className="compare-head">
                  <span className="compare-number" aria-hidden="true">{row.number}</span>
                  {open ? (
                    <button
                      type="button"
                      className="compare-title"
                      aria-pressed={pinnedId === row.changeSetId}
                      onClick={() => onPin(proposal)}
                      onFocus={() => onPreview(proposal)}
                      onBlur={() => onPreview(null)}
                    >
                      <span className="sr-only">Option {row.number}: </span>
                      {row.title}
                    </button>
                  ) : (
                    <span className="compare-title">
                      <span className="sr-only">Option {row.number}: </span>
                      {row.title}
                    </span>
                  )}
                  {row.status === "applied" ? <CircleCheck size={14} className="compare-state" aria-label="Applied" role="img" /> : null}
                  {row.status === "superseded" ? <CircleSlash size={14} className="compare-state" aria-label="Superseded" role="img" /> : null}
                </span>
                <span className="compare-summary">{row.summary}</span>
                {row.movesPinned ? (
                  <span className="compare-pinned">
                    <TriangleAlert size={12} aria-hidden="true" />
                    Moves a key you asked to keep
                  </span>
                ) : null}
                </div>
              </th>
              <td className="compare-num" data-zero={row.relearn === 0}>{row.relearn}</td>
              <td className="compare-num" data-zero={row.warnings === 0} data-warn={row.warnings > 0}>{row.warnings}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
