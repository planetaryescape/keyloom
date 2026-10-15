import { Gauge, LoaderCircle } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { Slot } from "../../layout/change.ts";
import type { HoldTapProfile, Layout } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { applyChange } from "../api-write.ts";
import { ChoiceGroup } from "./ChoiceGroup.tsx";
import {
  OPTIONS, optionsFromValues, tuningOps, tuningSummary, usersOf, valuesFromProfile, type HoldTap, type Scope, type Values,
} from "./tuning.ts";
import { useOpsCheck } from "./useCheck.ts";
import { Validation } from "./Validation.tsx";
import "./editor.css";

interface Props {
  token: string;
  layoutRef: string;
  layout: Layout;
  revisionId: string;
  slot: Slot;
  binding: HoldTap;
  /** Resolves once the new layout is on screen. */
  onApplied: (summary: string) => Promise<void>;
  /** The layout moved on under this panel; the parent reloads. */
  onStale: () => void;
}

// Tuning how a hold-tap feels means editing its profile, not the key (D-017). The same change set the
// agent proposes for "holding F feels slow": checked by the validator first, remembered if BK says why.
export function ProfileTuner({ token, layoutRef, layout, revisionId, slot, binding, onApplied, onStale }: Props) {
  const profile = layout.holdTapProfiles.find((p) => p.id === binding.profileId);
  if (profile === undefined) return null;
  return <Tuner key={`${revisionId}:${slot.layerId}:${slot.position}`} {...{ token, layoutRef, layout, revisionId, slot, binding, profile, onApplied, onStale }} />;
}

function Tuner({ token, layoutRef, layout, revisionId, slot, binding, profile, onApplied, onStale }: Props & { profile: HoldTapProfile }) {
  const id = useId();
  const shared = usersOf(layout, profile.id);
  const [values, setValues] = useState<Values>(() => valuesFromProfile(profile, layout));
  const [scope, setScope] = useState<Scope>(shared.length > 1 ? "key" : "profile");
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const built = useMemo(() => optionsFromValues(profile, values, layout), [profile, values, layout]);
  const ops = useMemo(
    () => (built.ok ? tuningOps({ layout, slot, binding, profile, options: built.options, scope }) : null),
    [built, layout, slot, binding, profile, scope],
  );
  const check = useOpsCheck({ token, layoutRef, revisionId, ops });
  const result = check.state.status === "done" ? check.state.result : null;
  const canApply = ops !== null && result !== null && result.ok && !applying;
  const specs = OPTIONS[profile.firmware];
  const keyNumber = slot.position + 1;

  async function apply() {
    if (!canApply || ops === null || !built.ok) return;
    const summary = tuningSummary(layout, slot, profile, built.options, scope);
    setApplying(true);
    setProblem(null);
    try {
      await applyChange(token, layoutRef, { baseRevisionId: revisionId, ops, summary, ...(reason.trim() === "" ? {} : { reason: reason.trim() }) });
      await onApplied(summary);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code?.startsWith("stale")) onStale();
      else if (error instanceof ApiError) {
        if (error.validation !== undefined) check.show(error.validation);
        // The server's message quotes the validator's own text; the problems are listed in words above.
        setProblem(error.validation === undefined ? error.message : "This change has problems, listed above. Nothing was saved.");
      } else setProblem("The change could not be applied.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="card tuner" aria-label={`Tune how key ${keyNumber} feels`}>
      <header className="tuner-head">
        <Gauge size={18} aria-hidden="true" />
        <div>
          <h2>Tune how key {keyNumber} feels</h2>
          <p className="muted">
            Timing profile &ldquo;{profile.name}&rdquo;, used by {shared.length} {shared.length === 1 ? "key" : "keys"}. Nothing is saved until you apply.
          </p>
        </div>
      </header>

      <fieldset className="tuner-body" disabled={applying}>
        <div className="tuner-fields">
          {specs.map((spec) => {
            const fieldId = `${id}-${spec.key}`;
            return (
              <div key={spec.key} className="tuner-field">
                <label htmlFor={fieldId}>{spec.label}</label>
                {spec.kind === "number" ? (
                  <span className="tuner-input">
                    <input
                      id={fieldId}
                      inputMode="numeric"
                      value={String(values[spec.key] ?? "")}
                      placeholder="Default"
                      onChange={(event) => { setProblem(null); setValues({ ...values, [spec.key]: event.target.value.trim() }); }}
                    />
                    <span aria-hidden="true">{spec.unit}</span>
                  </span>
                ) : spec.kind === "flag" ? (
                  <input
                    id={fieldId}
                    type="checkbox"
                    checked={values[spec.key] === true}
                    onChange={(event) => { setProblem(null); setValues({ ...values, [spec.key]: event.target.checked }); }}
                  />
                ) : (
                  <select
                    id={fieldId}
                    value={String(values[spec.key] ?? "")}
                    onChange={(event) => { setProblem(null); setValues({ ...values, [spec.key]: event.target.value }); }}
                  >
                    <option value="">Default</option>
                    {spec.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                )}
                <p className="muted">{spec.hint}</p>
              </div>
            );
          })}
        </div>

        {shared.length <= 1 ? null : (
          <ChoiceGroup
            legend="Change it for"
            variant="cards"
            value={scope}
            choices={[
              { value: "key", label: `Only key ${keyNumber}`, hint: "Gives this key a profile of its own. The others keep their feel." },
              { value: "profile", label: `All ${shared.length} keys`, hint: `Every key that uses "${profile.name}".` },
            ]}
            onChange={setScope}
          />
        )}

        {built.ok ? null : <p className="tuner-problem" role="alert">{built.problem}</p>}
        <Validation layout={layout} slot={slot} idleNote="Change a value and keyloom checks it here before anything is saved." state={check.state} onRecheck={check.recheck} />

        {ops === null ? null : (
          <div className="editor-reason">
            <label htmlFor={`${id}-why`}>Why this change? <span className="muted">Optional</span></label>
            <input id={`${id}-why`} value={reason} maxLength={300} placeholder="So you remember it later" onChange={(event) => setReason(event.target.value)} />
          </div>
        )}
      </fieldset>

      <footer className="tuner-foot">
        <p className="muted" aria-live="polite">{problem ?? (ops === null ? "Nothing is saved until you apply." : tuningSummary(layout, slot, profile, built.ok ? built.options : profile.options, scope))}</p>
        <button type="button" className="button button-primary" disabled={!canApply} onClick={() => void apply()}>
          {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
          {applying ? "Applying" : "Apply change"}
        </button>
      </footer>
    </section>
  );
}
