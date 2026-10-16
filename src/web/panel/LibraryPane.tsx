import type { Slot } from "../../layout/change.ts";
import type { Layout } from "../../layout/schema.ts";
import { libraryOf, type LibraryItem, positionsOn } from "./library.ts";
import { MiniCap, SheetHead } from "../shell/Sheet.tsx";
import "./library.css";

interface Props {
  layout: Layout;
  /** The layer on the board, so hovering a row highlights the keys on it. */
  layerId: string;
  /** Hovering or focusing a row or a place of use highlights those keys on the board; null clears it. */
  onHighlight: (positions: readonly number[] | null) => void;
  onOpenKey: (slot: Slot) => void;
  onClose: () => void;
}

// A list of what keys share (16#the-library-lists-what-keys-share-and-is-never-a-required-step). Nothing is made here: a macro or
// a tap dance is made on a key, and this shows where each one is used, so a shared one is never a surprise.
export function LibraryPane({ layout, layerId, onHighlight, onOpenKey, onClose }: Props) {
  const library = libraryOf(layout);
  const sections: ReadonlyArray<{ title: string; empty: string; items: LibraryItem[] }> = [
    { title: "Macros", empty: "None yet. Make one from a key's Macros tab.", items: library.macros },
    { title: "Tap dances", empty: "None yet. Fill When double-tapped on a key to make one.", items: library.tapDances },
    { title: "Timing profiles", empty: "None.", items: library.profiles },
  ];
  return (
    <section className="library" aria-label="Library">
      <SheetHead title="Library" lead="What your keys share. Point at one to see its keys on the board." closeLabel="Close the library" onClose={onClose} />
      <div className="sheet-body">
        {sections.map((section) => (
          <div key={section.title} className="sheet-section">
            <h3>{section.title}</h3>
            {section.items.length === 0 ? (
              <p className="sheet-empty">{section.empty}</p>
            ) : (
              <ul className="sheet-rows">
                {section.items.map((item) => (
                  <li
                    key={item.id}
                    className="sheet-row"
                    onMouseEnter={() => onHighlight(positionsOn(item.uses, layerId))}
                    onMouseLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight(positionsOn(item.uses, layerId))}
                    onBlur={() => onHighlight(null)}
                  >
                    <div className="sheet-row-main">
                      <p className="sheet-row-title">{item.name}</p>
                    </div>
                    <p className="sheet-row-meta">{item.detail}</p>
                    {item.uses.length === 0 ? (
                      <p className="sheet-row-meta">Not on any key.</p>
                    ) : (
                      <ul className="mini-caps library-uses" aria-label={`Where ${item.name} is used`}>
                        {item.uses.map((use) => (
                          <li key={use.label}>
                            {use.slot === undefined || use.legend === undefined ? (
                              <span className="sheet-row-meta">{use.label}</span>
                            ) : (
                              <button
                                type="button"
                                className="library-use"
                                aria-label={`Open ${use.label}`}
                                onClick={() => use.slot !== undefined && onOpenKey(use.slot)}
                                onMouseEnter={() => use.slot !== undefined && onHighlight(positionsOn([use], layerId))}
                              >
                                <MiniCap layer={use.slot.layerId === layerId ? undefined : use.layer}>{use.legend}</MiniCap>
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
