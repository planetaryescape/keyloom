import type { Layout, Mod } from "../../layout/schema.ts";
import { ChoiceGroup } from "./ChoiceGroup.tsx";
import { toggleMod, type Draft, type KeyChoice, type LayerAction } from "./draft.ts";
import { KeyPicker } from "./KeyPicker.tsx";
import { ModifierToggles } from "./ModifierToggles.tsx";

export interface FormProps {
  draft: Draft;
  layout: Layout;
  /** The layer being edited; a layer key can't usefully point at it with Hold. */
  layerId: string;
  /** Focus the first control on mount, for when the editor was just opened. */
  autoFocus: boolean;
  update: (patch: Partial<Draft>) => void;
}

function KeyChoiceField({
  title, choice, layout, onChange, qmkBasicOnly = false, autoFocus = false,
}: {
  title: string;
  choice: KeyChoice;
  layout: Layout;
  onChange: (choice: KeyChoice) => void;
  qmkBasicOnly?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="key-choice">
      <KeyPicker
        label={title}
        firmware={layout.firmware}
        value={choice.code}
        qmkBasicOnly={qmkBasicOnly}
        autoFocus={autoFocus}
        onChange={(code) => onChange({ ...choice, code })}
      />
      <ModifierToggles
        legend="Held with it (optional)"
        mods={choice.mods}
        onToggle={(mod: Mod) => onChange({ ...choice, mods: toggleMod(choice.mods, mod) })}
      />
    </div>
  );
}

export function KeyForm({ draft, layout, autoFocus, update }: FormProps) {
  return (
    <>
      <p className="form-lead">Sends one key. Turn on modifiers to send them together, such as Shift with 1.</p>
      <KeyChoiceField title="Key" choice={draft.key} layout={layout} autoFocus={autoFocus} onChange={(key) => update({ key })} />
    </>
  );
}

export function ModifierForm({ draft, update }: FormProps) {
  return (
    <>
      <p className="form-lead">Holds these modifiers while the key is down. Use it for a plain Shift, Ctrl, Alt or GUI key.</p>
      <ModifierToggles
        legend="Modifiers"
        mods={draft.modifier}
        onToggle={(mod) => update({ modifier: toggleMod(draft.modifier, mod) })}
      />
    </>
  );
}

export function HoldTapForm({ draft, layout, layerId, autoFocus, update }: FormProps) {
  const layers = layout.layers.map((layer) => ({
    value: layer.id,
    label: layer.name,
    disabled: layer.id === layerId,
  }));
  return (
    <>
      <p className="form-lead">One key, two jobs: a quick tap sends a key, holding it does something else.</p>
      <div className="form-split form-split-even">
        <section className="form-section">
          <h3>Tap</h3>
          <KeyChoiceField
            title="Tap key"
            choice={draft.tap}
            layout={layout}
            qmkBasicOnly
            autoFocus={autoFocus}
            onChange={(tap) => update({ tap })}
          />
        </section>
        <section className="form-section">
          <h3>Hold</h3>
          <ChoiceGroup
            legend="Hold does"
            variant="pills"
            value={draft.holdType}
            choices={[
              { value: "mods", label: "Modifier" },
              { value: "layer", label: "Layer" },
            ]}
            onChange={(holdType) => update({ holdType })}
          />
          {draft.holdType === "mods" ? (
            <ModifierToggles
              legend="Modifiers"
              mods={draft.holdMods}
              onToggle={(mod) => update({ holdMods: toggleMod(draft.holdMods, mod) })}
            />
          ) : (
            <ChoiceGroup
              legend="Layer to hold"
              variant="pills"
              value={draft.holdLayerId}
              choices={layers}
              onChange={(holdLayerId) => update({ holdLayerId })}
            />
          )}
          {layout.holdTapProfiles.length === 0 ? (
            <p className="form-note">This layout has no hold-tap profile, so a hold-tap can't be made here yet.</p>
          ) : (
            <ChoiceGroup
              legend="Timing profile"
              variant="cards"
              value={draft.profileId}
              choices={layout.holdTapProfiles.map((profile) => ({
                value: profile.id,
                label: profile.name,
                hint: Object.entries(profile.options).map(([key, value]) => `${key} ${String(value)}`).join(", "),
              }))}
              onChange={(profileId) => update({ profileId })}
            />
          )}
        </section>
      </div>
    </>
  );
}

const LAYER_ACTIONS: readonly { value: LayerAction; label: string; hint: string }[] = [
  { value: "momentary", label: "Hold", hint: "The layer is on while the key is held." },
  { value: "toggle", label: "Toggle", hint: "Each press switches the layer on or off." },
  { value: "to", label: "Go to", hint: "Switches to the layer and turns the others off." },
  { value: "oneShot", label: "One-shot", hint: "The layer applies to the next key press only." },
];

export function LayerForm({ draft, layout, autoFocus, update }: FormProps) {
  return (
    <div className="form-split form-split-even">
      <section className="form-section">
        <h3>What the key does</h3>
        <ChoiceGroup
          legend="Layer action"
          legendHidden
          variant="cards"
          value={draft.layerAction}
          choices={LAYER_ACTIONS}
          autoFocus={autoFocus}
          onChange={(layerAction) => update({ layerAction })}
        />
      </section>
      <section className="form-section">
        <h3>Which layer</h3>
        <ChoiceGroup
          legend="Target layer"
          legendHidden
          variant="cards"
          value={draft.layerId}
          choices={layout.layers.map((layer, index) => ({
            value: layer.id,
            label: layer.name,
            hint: `Layer ${index}`,
          }))}
          onChange={(layerId) => update({ layerId })}
        />
      </section>
    </div>
  );
}

export function MacroForm({ draft, layout, autoFocus, update }: FormProps) {
  if (layout.macros.length === 0) {
    return <p className="form-note">This layout has no macros yet. Macros are created from the CLI for now.</p>;
  }
  return (
    <>
      <p className="form-lead">Runs a macro: a saved sequence of key presses.</p>
      <ChoiceGroup
        legend="Macro"
        legendHidden
        variant="cards"
        value={draft.macroId}
        autoFocus={autoFocus}
        choices={layout.macros.map((macro) => ({
          value: macro.id,
          label: macro.name,
          hint: `${macro.steps.length} ${macro.steps.length === 1 ? "step" : "steps"}`,
        }))}
        onChange={(macroId) => update({ macroId })}
      />
    </>
  );
}

export function PlainForm({ draft, layerId, layout }: FormProps) {
  if (draft.kind === "transparent") {
    const base = layout.layers[0]?.name ?? "the base layer";
    return (
      <p className="form-lead">
        {layerId === layout.layers[0]?.id
          ? "Does nothing here: there is no layer beneath the base layer to fall through to."
          : `Falls through to ${base}, so this key does whatever ${base} does in the same place.`}
      </p>
    );
  }
  if (draft.kind === "none") return <p className="form-lead">The key does nothing when pressed, and it does not fall through to a layer beneath.</p>;
  return (
    <p className="form-lead">
      A firmware-specific binding keyloom doesn&apos;t model: {draft.native?.firmware.toUpperCase()}{" "}
      <code>{draft.native?.source}</code>. It is passed through as written. Pick another kind to replace it.
    </p>
  );
}
