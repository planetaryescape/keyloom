import { Keyboard } from "lucide-react";
import type { ReactNode } from "react";

const importedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export interface HeaderFacts {
  layoutName: string;
  board: string;
  firmware: string;
  keyCount: number;
  layerCount: number;
  createdAt: number;
  revisionId: string;
}

// The ULID's random tail tells revisions apart; its head is a timestamp shared by neighbours.
const shortRevision = (id: string): string => id.slice(-6);

export function Header({ facts, picker, actions }: { facts?: HeaderFacts; picker?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Keyboard size={16} />
        </span>
        keyloom
      </div>
      {facts === undefined ? null : (
        <div className="identity">
          <div className="identity-main">
            <h1 className="layout-name" title={facts.layoutName}>
              {facts.layoutName}
            </h1>
            <ul className="meta">
              <li>{facts.board}</li>
              <li>{facts.firmware.toUpperCase()}</li>
              <li>
                {facts.keyCount} keys, {facts.layerCount} layers
              </li>
            </ul>
          </div>
          <ul className="meta">
            <li>Imported {importedAt.format(facts.createdAt)}</li>
            <li title={facts.revisionId}>Revision {shortRevision(facts.revisionId)}</li>
          </ul>
        </div>
      )}
      {picker}
      {actions === undefined ? null : <div className="header-actions">{actions}</div>}
    </header>
  );
}
