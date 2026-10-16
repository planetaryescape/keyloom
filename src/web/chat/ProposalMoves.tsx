import { ArrowRight, CircleSlash } from "lucide-react";
import type { ProposalCard } from "../../api/http.ts";
import type { Layout } from "../../layout/schema.ts";
import { functionName } from "../editor/function-label.ts";
import { movesOf } from "./compare.ts";
import { layerName } from "./proposal-facts.ts";
import "./compare.css";

interface Props {
  proposal: ProposalCard;
  layout: Layout;
}

// Where the functions this change pushes out of the way end up (07's diff.displaced), and what it
// drops. When both ends are on one layer its name is said once.
export function ProposalMoves({ proposal, layout }: Props) {
  const moves = movesOf(proposal);
  const { dropped } = proposal.validation.diff;
  if (moves.length === 0 && dropped.length === 0) return null;
  return (
    <div className="proposal-section proposal-moves">
      <h4>Moves</h4>
      <ul>
        {moves.map((move) => {
          const sameLayer = move.from.layerId === move.to.layerId;
          return (
            <li key={move.key}>
              <kbd>{functionName(move.function, layout)}</kbd>
              <span className="moves-path">
                <span>{layerName(layout, move.from.layerId)}, key {move.from.position + 1}</span>
                <ArrowRight size={14} aria-label="moves to" role="img" />
                <strong>{sameLayer ? `key ${move.to.position + 1}` : `${layerName(layout, move.to.layerId)}, key ${move.to.position + 1}`}</strong>
              </span>
            </li>
          );
        })}
        {dropped.map((d) => (
          <li key={d.function} data-dropped="true">
            <kbd>{functionName(d.function, layout)}</kbd>
            <span className="moves-path">
              <CircleSlash size={14} aria-hidden="true" />
              <span><strong>Dropped</strong>: {d.reason}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
