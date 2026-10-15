import { ArrowRight, MousePointer2, Pencil } from "lucide-react";
import type { KeyDescription } from "../../layout/describe.ts";
import { Cap } from "../keyboard/Cap.tsx";
import "./inspector.css";

const KIND_NAME: Record<KeyDescription["kind"], string> = {
  key: "Plain key",
  modifier: "Modifier",
  holdTap: "Hold-tap",
  layer: "Layer key",
  macro: "Macro",
  native: "Native binding",
  transparent: "Transparent",
  none: "Empty",
};

interface InspectorProps {
  /** Null when no key is selected or hovered. */
  description: KeyDescription | null;
  position: number | null;
  finger: string | undefined;
  layerName: string;
  /** What each key position prints, to name a combo's other keys. */
  tapAt: (position: number) => string;
  onOpenLayer: (layerId: string) => void;
  /** Opens the binding editor for the selected key; absent when nothing can be edited. */
  onEdit?: () => void;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function Inspector({ description, position, finger, layerName, tapAt, onOpenLayer, onEdit }: InspectorProps) {
  if (description === null || position === null) {
    return (
      <section className="card inspector inspector--idle" aria-label="Key details">
        <div className="inspector-idle">
          <MousePointer2 size={22} aria-hidden="true" />
          <p>
            <strong>Pick a key to see what it does</strong>
            Tap, hover or click one, or Tab into the keyboard and use the arrow keys. Press Enter on a key to edit it.
          </p>
        </div>
      </section>
    );
  }
  const where = [
    KIND_NAME[description.kind],
    `Position ${position + 1}`,
    finger === undefined ? undefined : `${capitalise(finger.replace("-", " "))} finger`,
    layerName,
  ].filter((part) => part !== undefined);

  return (
    <section className="card inspector" aria-label="Key details">
      <div className="inspector-head" aria-live="polite">
        <div className="inspector-cap">
          <Cap
            as="span"
            tone={description.kind}
            legend={description.legend}
            unit={64}
            width={1}
            style={{ width: 64, height: 64 }}
          />
        </div>
        <div className="inspector-title">
          <p className="inspector-headline">{description.headline}</p>
          <p className="inspector-where">{where.join(" · ")}</p>
          {onEdit === undefined ? null : (
            <button type="button" className="button button-primary inspector-edit" onClick={onEdit}>
              <Pencil size={14} aria-hidden="true" />
              Edit key
            </button>
          )}
        </div>
      </div>

      <div className="inspector-detail">
        {description.fields.length > 0 ? (
          <dl className="fields">
            {description.fields.map((field) => (
              <div key={field.label} className={field.code ? "field field-code" : "field"}>
                <dt>{field.label}</dt>
                <dd>
                  {field.label === "Firmware" ? <span className="badge">{field.value}</span> : field.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {description.options.length > 0 ? (
          <ul className="chips" aria-label="Profile options">
            {description.options.map((option) => (
              <li key={option} className="chip">
                {option}
              </li>
            ))}
          </ul>
        ) : null}

        {description.steps.length > 0 ? (
          <div className="inspector-section">
            <h3>Steps</h3>
            <ol className="steps">
              {description.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {description.combos.length > 0 ? (
          <div className="inspector-section">
            <h3>Combos using this key</h3>
            <ul className="combos">
              {description.combos.map((combo) => (
                <li key={combo.name} className={combo.activeHere ? "combo-use" : "combo-use combo-off"}>
                  <span className="combo-dot" aria-hidden="true" />
                  <span>
                    {combo.name}: with {combo.partners.map(tapAt).join(" + ")} {"→"} {combo.output}
                    {combo.activeHere ? "" : ` (only on ${combo.scope})`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {description.targetLayerId === undefined ? null : (
          <button
            type="button"
            className="button"
            onClick={() => onOpenLayer(description.targetLayerId as string)}
          >
            Show that layer
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
