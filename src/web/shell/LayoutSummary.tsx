import type { LayoutSummary as Summary, RevisionInfo } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import { niceLayerName } from "../../layout/layer-ops.ts";
import { layerLegend } from "../../layout/legend.ts";
import type { Layout } from "../../layout/schema.ts";
import { Legend } from "../inspector/Legend.tsx";
import { boardTitle } from "./Header.tsx";

const importedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// The ULID's random tail tells revisions apart; its head is a timestamp shared by neighbours.
const shortRevision = (id: string): string => id.slice(-6);

interface Props {
  summary: Summary;
  layout: Layout;
  board: BoardDefinition;
  revision: RevisionInfo;
}

// What the side panel shows when nothing else is open: the facts that used to crowd the header
// (18: the import date, revision and key count move here), and what each kind of key looks like.
export function LayoutSummary({ summary, layout, board, revision }: Props) {
  const ctx = { layers: layout.layers, macros: layout.macros };
  return (
    <section className="summary" aria-label="Layout summary">
      <header className="panel-head">
        <div className="panel-title">
          <h2>{summary.name}</h2>
          <p className="muted">{boardTitle(summary.boardId)}</p>
        </div>
      </header>
      <div className="summary-body">
        <dl className="facts">
          <div><dt>Board</dt><dd>{board.vendor} {board.name}</dd></div>
          <div><dt>Firmware</dt><dd>{layout.firmware.toUpperCase()}</dd></div>
          <div><dt>Keys</dt><dd>{board.keyCount}</dd></div>
          <div><dt>Layers</dt><dd>{layout.layers.length}</dd></div>
          <div><dt>Imported</dt><dd>{importedAt.format(summary.createdAt)}</dd></div>
          <div><dt>Revision</dt><dd title={revision.id}>{shortRevision(revision.id)}</dd></div>
        </dl>
        <section aria-label="Layers">
          <h3>Layers</h3>
          <ol className="layer-list">
            {layout.layers.map((layer) => (
              <li key={layer.id}>
                <span className="layer-list-label" aria-hidden="true">{layerLegend(layer.id, ctx)}</span>
                <span>{niceLayerName(layer.name)}</span>
              </li>
            ))}
          </ol>
        </section>
        <Legend firmware={layout.firmware} />
      </div>
    </section>
  );
}
