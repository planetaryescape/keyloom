import { ArrowRight, LoaderCircle, Plus, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { describeKey, modsWords } from "../../layout/describe.ts";
import { bindingLegend } from "../../layout/legend.ts";
import { deepEqual } from "../../layout/equal.ts";
import type { Binding, HoldTapProfile, Layout, Macro, Mod, SlotAction } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { applyChange } from "../api-write.ts";
import {
  bindingFromDraft, bindingSummary, changeSummary, draftFromBinding, incompleteReason, isDance, keyWords, type Draft,
} from "../editor/draft.ts";
import { ChoiceGroup } from "../editor/ChoiceGroup.tsx";
import { functionName } from "../editor/function-label.ts";
import { LostFunctions, type LostRow } from "../editor/LostFunctions.tsx";
import { ModifierToggles } from "../editor/ModifierToggles.tsx";
import { ProfileTuner } from "../editor/ProfileTuner.tsx";
import { usersOf } from "../editor/tuning.ts";
import {
  type LostFunction, type Placement, canDrop, dropReason, keyName, lostFunctionsIn, placeableBinding, splitLost,
} from "../editor/lost-functions.ts";
import { useOpsCheck } from "../editor/useCheck.ts";
import { Validation } from "../editor/Validation.tsx";
import { advancedLegend } from "../keyboard/advanced-legend.ts";
import { Cap } from "../keyboard/Cap.tsx";
import { distinguishingWords, profileWords } from "../../layout/option-words.ts";
import { keyChange, macroUsers } from "./change-ops.ts";
import {
  canAddExtraSlot, canToggleSlotMods, clearExtraSlot, danceUsers, setExtraSlot, slotFromPick, slotMods, slotWords, toggleSlotMod, type ExtraSlot,
} from "./dance.ts";
import { MacroPane } from "./MacroPane.tsx";
import { isExtraSlot, openingTab, type PickerTab, type SlotName } from "./picker-items.ts";
import { SlotPicker } from "./SlotPicker.tsx";
import {
  addHold, canAddHold, canToggleTapMods, clearHold, hasHold, keyForChar, modOfKey, pickHold, pickTap, profileFor, tapKind, tapMods, toggleHoldMod,
  toggleTapMod, type TapPick,
} from "./slots.ts";
import { whereElse, whereElseSentence } from "./where-else.ts";
import "./panel.css";

/** A kept function waiting for a key to be clicked: what to put there, copied from where it was. */
export interface PlaceRequest {
  function: string;
  binding: Binding;
}

export interface DraftState {
  /** The draft as a binding when it is complete and differs from what is applied. */
  binding: Binding | null;
  /** True once anything has been touched, even if the draft is not complete. */
  dirty: boolean;
  /** The layout once the change is applied, with the tap dance and macros it brings; the board draws the key from it. */
  after: Layout | null;
}

export interface KeyPanelHandle {
  /** Applies the draft if it can be applied. */
  apply: () => void;
  /** Closes an open picker and says whether there was one, so Escape closes the picker before the panel. */
  closePicker: () => boolean;
}

interface Props {
  token: string;
  layoutRef: string;
  layout: Layout;
  revisionId: string;
  layerId: string;
  position: number;
  finger: string | undefined;
  /** Whether the key is on the board's home row, which picks home-row mods as a new hold-tap's timing. */
  homeRow: boolean;
  advanced: boolean;
  /** Focus the picker when the panel was just opened by a click or Enter; false when it followed the selection. */
  autoFocus: boolean;
  /** The person tried to select another key while this draft had unsaved changes. */
  blocked: boolean;
  onDraft: (state: DraftState) => void;
  /** Keys the person chose to keep a lost function on, and the function waiting for a click on the board. */
  placements: readonly Placement[];
  placing: PlaceRequest | null;
  onPlace: (request: PlaceRequest | null) => void;
  onUnplace: (fn: string) => void;
  onClose: () => void;
  /** Resolves once the new layout is on screen. `change` is what the key was and became, for "repeat on selection". */
  onApplied: (summary: string, change: { before: Binding; after: Binding }) => Promise<void>;
  /** A hold-tap's timing was tuned. */
  onTuned: (summary: string) => Promise<void>;
  /** The layout moved on under this panel; the parent reloads and closes it. */
  onStale: () => void;
  onShowLayer: (layerId: string) => void;
  /** Controls that act on this key from outside its draft: swap, copy and paste (16#moving-and-copying-keys). */
  footerExtra?: ReactNode;
  handle?: Ref<KeyPanelHandle>;
}

type OpenPicker = { slot: SlotName; tab: PickerTab } | null;

// The panel remembers nothing between keys: it is keyed by key and revision, so a new key or an
// applied change starts it fresh from the saved layout.
export function KeyPanel(props: Props) {
  const {
    token, layoutRef, layout, revisionId, layerId, position, finger, homeRow, advanced, autoFocus, blocked, onDraft, placements, placing,
    onPlace, onUnplace, onClose, onApplied, onTuned, onStale, onShowLayer, footerExtra, handle,
  } = props;
  const layerIndex = layout.layers.findIndex((layer) => layer.id === layerId);
  const layer = layout.layers[layerIndex];
  const original = layer?.bindings[position];
  const initial = useMemo(
    () => (original === undefined ? null : draftFromBinding(original, layout, layerId)),
    // The panel is keyed by key and revision, so the layout it opened on is the one it edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [draft, setDraft] = useState<Draft | null>(initial);
  // An empty key opens its tap picker at once, so "click the key, pick A" is two clicks.
  const [picker, setPicker] = useState<OpenPicker>(() => (original?.kind === "transparent" || original?.kind === "none" ? { slot: "tap", tab: "letters" } : null));
  const [focusPicker, setFocusPicker] = useState(autoFocus);
  const [profileTouched, setProfileTouched] = useState(false);
  const [choosingProfile, setChoosingProfile] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const root = useRef<HTMLElement>(null);
  // Replacing a native binding drops behaviour keyloom cannot rebuild, so it takes a second press.
  const [confirmingNative, setConfirmingNative] = useState(false);
  useEffect(() => {
    setFocusPicker(false);
    // After an apply the panel is made again from the saved layout, and the focus that was in the old one is gone.
    const active = document.activeElement;
    if (picker === null && (active === null || active === document.body)) root.current?.focus({ preventScroll: true });
    // Only on mount: later focus belongs to what the person is doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The handle outlives renders, so it calls through a ref to the latest apply and closePicker.
  const latest = useRef({ apply: () => {}, closePicker: (): boolean => false });
  useImperativeHandle(handle, () => ({ apply: () => latest.current.apply(), closePicker: () => latest.current.closePicker() }), []);

  const draftBinding = draft === null ? null : bindingFromDraft(draft, layout);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(initial);
  const slot = useMemo(() => ({ layerId, position }), [layerId, position]);
  // Functions the person chose to let go of; each becomes a dropFunction op with a generated reason.
  const [drops, setDrops] = useState<ReadonlySet<string>>(new Set());
  // What the draft stands for as a change: the key, and the tap dance and macros that come with it (D-086).
  const planned = useMemo(
    () => (draft === null || draftBinding === null || original === undefined ? null : keyChange({ layout, slot, draft, binding: draftBinding, original, placements, drops: new Map() })),
    // draftBinding follows the draft, so the draft is what to watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, layout, slot, original, placements],
  );
  const changed = planned !== null && planned.after !== null && !deepEqual(planned.after, layout);
  const binding = changed && planned !== null ? planned.binding : null;
  const after = changed && planned !== null ? planned.after : null;
  const replacedBy = useMemo(
    () => (binding === null || after === null || layerIndex < 0 ? "" : (describeKey(after, layerIndex, position)?.headline ?? "")),
    [binding, after, layerIndex, position],
  );
  const ops = useMemo(
    () =>
      binding === null || draft === null || original === undefined || draftBinding === null
        ? null
        : keyChange({ layout, slot, draft, binding: draftBinding, original, placements, drops: new Map([...drops].map((fn) => [fn, dropReason(replacedBy, layout, slot)])) }).ops,
    // The draft decides the binding; the reason text decides the drops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [binding, draft, slot, placements, drops, replacedBy, layout],
  );
  const check = useOpsCheck({ token, layoutRef, revisionId, ops });
  // The last answer's lost functions stay on screen while the next check runs, so the buttons don't flicker away.
  const [lostNow, setLostNow] = useState<LostRow[]>([]);
  const [strandedNow, setStrandedNow] = useState<LostFunction[]>([]);
  useEffect(() => {
    if (check.state.status === "idle") {
      setLostNow([]);
      setStrandedNow([]);
      setDrops((previous) => (previous.size === 0 ? previous : new Set()));
    }
    if (check.state.status !== "done") return;
    const { result } = check.state;
    const { direct, collateral } = splitLost(lostFunctionsIn(result), [slot, ...placements.map((placement) => placement.slot)]);
    setLostNow(direct.map((lost) => ({ lost, droppable: canDrop(lost, layout, result) })));
    setStrandedNow(collateral);
  }, [check.state, slot, placements, layout]);

  const changeKey = binding === null || planned === null ? "" : JSON.stringify(planned.ops);
  useEffect(() => {
    onDraft({ binding, dirty, after });
    // The ops stand for the change, so a new object with the same content doesn't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeKey, dirty]);

  const current = useMemo(() => describeKey(layout, layerIndex, position), [layout, layerIndex, position]);
  const where = useMemo(() => (original === undefined ? [] : whereElse(layout, slot, original)), [layout, slot, original]);

  const update = (next: Draft | ((previous: Draft) => Draft)) => {
    setApplyError(null);
    setConfirmingNative(false);
    setDraft((previous) => (previous === null ? previous : typeof next === "function" ? next(previous) : next));
  };

  function closePicker(): boolean {
    if (picker === null) return false;
    setPicker(null);
    root.current?.focus({ preventScroll: true });
    return true;
  }

  function openPicker(slotName: SlotName, tab?: PickerTab) {
    setFocusPicker(true);
    setPicker((open) => (open?.slot === slotName && tab === undefined ? null : { slot: slotName, tab: openingTab(slotName, tab ?? null) }));
  }

  // A tap dance from the library, used on this key too. Changing it afterwards changes a copy unless "every key" is chosen.
  function useDance(danceId: string) {
    update(draftFromBinding({ kind: "tapDance", tapDanceId: danceId }, layout, layerId));
    setPicker(null);
    root.current?.focus({ preventScroll: true });
  }

  // A macro made in the picker is saved with the change, and the slot points at it.
  function finishMacro(slotName: SlotName, macro: Macro) {
    update((previous) => {
      const withMacro = { ...previous, pendingMacros: [...previous.pendingMacros.filter((m) => m.id !== macro.id), macro] };
      if (slotName === "tap") return pickTap(withMacro, { t: "macro", macroId: macro.id });
      return isExtraSlot(slotName) ? setExtraSlot(withMacro, slotName as ExtraSlot, { kind: "macro", macroId: macro.id }, layout, slot) : previous;
    });
    setPicker(null);
    root.current?.focus({ preventScroll: true });
  }

  function pick(slotName: SlotName, choice: TapPick) {
    if (choice.t === "dance") {
      useDance(choice.danceId);
      return;
    }
    update((previous) => {
      if (slotName === "tap") return pickTap(previous, choice);
      if (isExtraSlot(slotName)) {
        const action = slotFromPick(choice);
        return action === null ? previous : setExtraSlot(previous, slotName as ExtraSlot, action, layout, slot);
      }
      if (choice.t === "layer") {
        const next = pickHold(previous, { t: "layer", layerId: choice.layerId });
        return profileTouched ? next : { ...next, profileId: profileFor(layout, "layer", homeRow) };
      }
      const mod = choice.t === "key" ? modOfKey(choice.code) : undefined;
      if (mod === undefined) return previous;
      const next = pickHold(previous, { t: "mods", mods: [mod] });
      return profileTouched ? next : { ...next, profileId: profileFor(layout, "mods", homeRow) };
    });
    setPicker(null);
    root.current?.focus({ preventScroll: true });
  }

  // Typing a character with the picker closed fills the tap slot (18#keyboard-use): "click the key,
  // press A" is a complete edit. Text fields, menus and dialogs keep their own typing.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (picker !== null || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"], [role="menu"]')) return;
      // Space on a focused button presses it.
      if (event.key === " " && target?.closest("button") !== null) return;
      const key = keyForChar(event.key);
      if (key === undefined) return;
      event.preventDefault();
      pick("tap", { t: "key", code: key.name });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // pick closes over state that only matters through setDraft's functional form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker]);

  if (draft === null || layer === undefined || original === undefined) return null;

  const incomplete = incompleteReason(draft, layout);
  const summary = binding === null ? null : withChoices(changeSummary(after ?? layout, layerId, position, binding), after ?? layout, placements, drops);
  const result = check.state.status === "done" ? check.state.result : null;
  const canApply = binding !== null && result !== null && result.ok && !applying;
  const warnings = result?.warnings.length ?? 0;
  const replacesNative = original.kind === "native" && binding !== null && binding.kind !== "native";
  const profile = layout.holdTapProfiles.find((candidate) => candidate.id === draft.profileId);

  async function apply() {
    if (!canApply || binding === null || summary === null || original === undefined || ops === null) return;
    if (replacesNative && !confirmingNative) {
      setConfirmingNative(true);
      return;
    }
    setApplying(true);
    setApplyError(null);
    try {
      await applyChange(token, layoutRef, {
        baseRevisionId: revisionId,
        ops: ops ?? [],
        summary,
        ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
      });
      await onApplied(summary, { before: original, after: binding });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code?.startsWith("stale")) {
        onStale();
      } else if (error instanceof ApiError) {
        if (error.validation !== undefined) check.show(error.validation);
        // The server's message quotes the validator's own text; the problems are listed in words above.
        setApplyError(error.validation === undefined ? error.message : "This change has problems, listed above. Nothing was saved.");
      } else {
        setApplyError("The change could not be applied.");
      }
    } finally {
      setApplying(false);
    }
  }

  latest.current = { apply: () => void apply(), closePicker };

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    // Enter on a button presses that button; in the tuner it belongs to the tuner's own form.
    if ((target?.closest("button, select, textarea, a, summary, .tuner") ?? null) !== null && !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void apply();
  }

  const tap = tapKind(draft);
  const keysOnly = hasHold(draft);
  const drawn = after ?? layout;
  const ctx = { layers: drawn.layers, macros: drawn.macros, tapDances: drawn.tapDances };
  const shownLegend = bindingLegend(binding ?? draftBinding ?? original, ctx);
  const shownTone = (binding ?? draftBinding ?? original).kind;
  const where2 = [layer.name, finger === undefined ? undefined : `${finger.replace("-", " ")} finger`].filter(Boolean).join(" · ");
  const applyLabel = applying ? "Applying" : confirmingNative ? "Replace and apply" : warnings > 0 ? `Apply with ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : "Apply";
  const whyNot =
    binding === null
      ? dirty ? (incomplete ?? "This is the same as the key now.") : null
      : check.state.status === "checking" ? "Checking the change." : result !== null && !result.ok ? "Fix the errors above first." : null;

  const slotText = tapSlotText(draft, layout);
  const holdText = holdSlotText(draft, layout);
  const selectedTap = new Set(selectedIdsFor("tap", draft));
  const selectedHold = new Set(selectedIdsFor("hold", draft));
  const shownBinding = binding ?? draftBinding;
  const advancedText = advanced && shownBinding !== null ? advancedLegend(shownBinding, drawn) : null;

  // The macro builder for the open slot, on the Macro tab only.
  function macroPaneFor(slotName: SlotName) {
    if (picker?.slot !== slotName || picker.tab !== "macro" || (slotName === "tap" && keysOnly)) return {};
    const held = slotName === "tap" ? (draft?.kind === "macro" ? draft.macroId : null) : slotName === "doubleTap" ? macroIdOf(draft?.doubleTap) : macroIdOf(draft?.tapThenHold);
    return {
      macroPane: (
        <MacroPane
          layout={layout}
          layerId={layerId}
          position={position}
          currentMacroId={held}
          pending={draft?.pendingMacros ?? []}
          autoFocus={focusPicker}
          onDone={(macro) => finishMacro(slotName, macro)}
          onUse={(macroId) => pick(slotName, { t: "macro", macroId })}
        />
      ),
    };
  }

  // One of the tap dance's extra slots: a row when it is filled, an add button when it is not, and the picker and modifier toggles beside it.
  function extraSlot(which: ExtraSlot, label: string) {
    const action = draft?.[which] ?? null;
    const open = picker?.slot === which;
    return (
      <>
        {action === null && !open ? (
          <button
            type="button"
            className="slot slot-add"
            onClick={() => {
              setFocusPicker(true);
              setPicker({ slot: which, tab: "letters" });
            }}
          >
            <Plus size={14} aria-hidden="true" />
            {label}
          </button>
        ) : (
          <SlotRow
            label={label}
            value={action === null ? "Choose" : slotWords(action, drawn)}
            open={open}
            onToggle={() => openPicker(which)}
            onClear={() => {
              update((previous) => clearExtraSlot(previous, which));
              setPicker(null);
            }}
            clearLabel={`Clear ${label.toLowerCase()}`}
          />
        )}
        {open ? (
          <SlotPicker
            slot={which}
            tab={picker.tab}
            onTab={(tab) => setPicker({ slot: which, tab })}
            layout={layout}
            layerId={layerId}
            keysOnly={false}
            advanced={advanced}
            selectedIds={new Set(action === null ? [] : slotSelectedIds(action))}
            initialLayerAction={action?.kind === "layer" ? action.action : "toggle"}
            autoFocus={focusPicker}
            token={token}
            layoutRef={layoutRef}
            position={position}
            onPick={(choice) => pick(which, choice)}
            onUseBinding={() => {}}
            {...macroPaneFor(which)}
          />
        ) : null}
        {action !== null && canToggleSlotMods(action) ? (
          <Mods
            legend={action.kind === "modifier" ? "Modifiers" : "Sent together with it"}
            prompt="Add Shift, Ctrl, Alt or GUI"
            mods={slotMods(action)}
            hidden={picker !== null}
            onToggle={(mod: Mod) => update((previous) => (previous[which] === null ? previous : { ...previous, [which]: toggleSlotMod(previous[which] as SlotAction, mod) }))}
          />
        ) : null}
      </>
    );
  }

  return (
    <section ref={root} tabIndex={-1} className="key-panel" aria-label={`Key ${position + 1}`} onKeyDown={onKeyDown}>
      <header className="panel-head">
        <span className="panel-cap" data-pending={binding !== null}>
          <Cap as="span" tone={shownTone} legend={advancedText ?? shownLegend} unit={48} width={1} style={{ width: 48, height: 48 }} breakable={advancedText !== null} />
        </span>
        <div className="panel-title">
          <h2>Key {position + 1}</h2>
          <p className="muted">{where2}</p>
        </div>
        <button type="button" className="icon-button" aria-label="Close the key panel" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <fieldset className="panel-body" disabled={applying}>
        <p className="panel-now" aria-live="polite">
          <span className="panel-now-label">Now</span>
          <span>{current?.headline ?? ""}</span>
          {binding === null ? null : (
            <>
              <ArrowRight size={14} aria-hidden="true" />
              <strong>{bindingSummary(binding, drawn)}</strong>
            </>
          )}
        </p>

        <div className="slots">
          <SlotRow
            label="When tapped"
            value={slotText}
            open={picker?.slot === "tap"}
            onToggle={() => openPicker("tap")}
            code={advanced && advancedText !== null ? advancedText.tap : undefined}
          />
          {picker?.slot === "tap" ? (
            <SlotPicker
              slot="tap"
              tab={picker.tab}
              onTab={(tab) => setPicker({ slot: "tap", tab })}
              layout={layout}
              layerId={layerId}
              keysOnly={keysOnly}
              advanced={advanced}
              selectedIds={selectedTap}
              initialLayerAction={draft.layerAction}
              autoFocus={focusPicker}
              token={token}
              layoutRef={layoutRef}
              position={position}
              onPick={(choice) => pick("tap", choice)}
              onUseBinding={(parsed) => {
                update(draftFromBinding(parsed, layout, layerId));
                setPicker(null);
                root.current?.focus({ preventScroll: true });
              }}
              {...macroPaneFor("tap")}
            />
          ) : null}
          {canToggleTapMods(draft) ? (
            <Mods
              legend={tap === "modifier" ? "Modifiers" : "Sent together with it"}
              prompt={tap === "modifier" ? "Add modifiers" : "Add Shift, Ctrl, Alt or GUI"}
              mods={tapMods(draft)}
              hidden={picker !== null}
              onToggle={(mod: Mod) => update((previous) => toggleTapMod(previous, mod))}
            />
          ) : null}
          {draft.kind === "native" && draft.native !== null ? (
            <p className="form-note">
              keyloom keeps this {draft.native.firmware.toUpperCase()} binding as written, <code>{draft.native.source}</code>. Picking something else replaces it.
              {/^TD\(DANCE_\d+\)$/.test(draft.native.source) ? " It is a tap dance from an earlier import. Import your Oryx layout again and keyloom will read its taps so you can edit them here." : ""}
            </p>
          ) : null}
          {draft.kind === "tapDance" ? (
            <p className="form-note">
              This tap dance has a slot the panel can&apos;t show yet, such as a hold that toggles a layer. It is left as it is; the chat or the CLI can change it, and picking something else here replaces it.
            </p>
          ) : null}
          {draft.kind === "transparent" ? <p className="form-note">{transparentNote(layout, layerId)}</p> : null}
          {draft.kind === "layer" && draft.layerId !== null ? (
            <button type="button" className="button" onClick={() => onShowLayer(draft.layerId as string)}>
              Show that layer
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : null}

          {hasHold(draft) ? (
            <>
              <SlotRow
                label="When held"
                value={holdText}
                open={picker?.slot === "hold"}
                onToggle={() => openPicker("hold")}
                onClear={() => {
                  update((previous) => clearHold(previous));
                  setPicker(null);
                }}
                clearLabel="Clear the hold"
              />
              {picker?.slot === "hold" ? (
                <SlotPicker
                  slot="hold"
                  tab={picker.tab}
                  onTab={(tab) => setPicker({ slot: "hold", tab })}
                  layout={layout}
                  layerId={layerId}
                  keysOnly
                  advanced={advanced}
                  selectedIds={selectedHold}
                  initialLayerAction="momentary"
                  autoFocus={focusPicker}
                  token={token}
                  layoutRef={layoutRef}
                  position={position}
                  onPick={(choice) => pick("hold", choice)}
                  onUseBinding={() => {}}
                />
              ) : null}
              {draft.holdType === "mods" ? (
                <Mods
                  legend="Held modifiers"
                  prompt="Add more modifiers"
                  mods={draft.holdMods}
                  hidden={picker !== null}
                  onToggle={(mod: Mod) => update((previous) => toggleHoldMod(previous, mod))}
                />
              ) : null}
            </>
          ) : canAddHold(draft) ? (
            <button
              type="button"
              className="slot slot-add"
              onClick={() => {
                update((previous) => addHold(previous, profileFor(layout, "mods", homeRow)));
                setFocusPicker(true);
                setPicker({ slot: "hold", tab: "modifiers" });
              }}
            >
              <Plus size={14} aria-hidden="true" />
              When held
            </button>
          ) : null}

          {canAddExtraSlot(draft) ? (
            <>
              {extraSlot("doubleTap", "When double-tapped")}
              {extraSlot("tapThenHold", "When tapped, then held")}
            </>
          ) : null}
        </div>

        {isDance(draft) ? (
          <DanceTiming
            term={draft.danceTermMs}
            fallback={defaultTermMs(layout)}
            hasHold={hasHold(draft)}
            others={draft.danceId === null ? 0 : danceUsers(layout, draft.danceId, slot).length}
            forAll={draft.danceForAll}
            onTerm={(ms) => update((previous) => ({ ...previous, danceTermMs: ms }))}
            onForAll={(value) => update((previous) => ({ ...previous, danceForAll: value }))}
          />
        ) : null}

        {hasHold(draft) && !isDance(draft) ? (
          <Timing
            layout={layout}
            profile={profile}
            profileId={draft.profileId}
            holdLayer={draft.holdType === "layer"}
            choosing={choosingProfile}
            onChoosing={setChoosingProfile}
            onProfile={(id) => {
              setProfileTouched(true);
              update((previous) => ({ ...previous, profileId: id }));
              setChoosingProfile(false);
            }}
            tuning={tuning}
            onTuning={setTuning}
            savedHoldTap={original.kind === "holdTap" && original.profileId === draft.profileId && !changed ? original : null}
            tuneBlockedReason={original.kind !== "holdTap" ? "Apply this hold first, then tune how it feels." : changed ? "Apply your change first, then tune how it feels." : original.profileId !== draft.profileId ? "Apply the profile change first, then tune it." : null}
            tuner={
              original.kind === "holdTap" && !changed && original.profileId === draft.profileId ? (
                <ProfileTuner
                  token={token}
                  layoutRef={layoutRef}
                  layout={layout}
                  revisionId={revisionId}
                  slot={slot}
                  binding={original}
                  onApplied={onTuned}
                  onStale={onStale}
                />
              ) : null
            }
          />
        ) : null}

        {where.length === 0 ? null : (
          <ul className="where-else" aria-label="Where else the key's function lives">
            {where.map((entry) => (
              <li key={entry.function} data-alone={entry.others.length === 0}>{whereElseSentence(entry, layout)}.</li>
            ))}
          </ul>
        )}

        {binding === null ? null : (
          <LostFunctions
            layout={layout}
            rows={lostNow}
            strandedCount={strandedNow.length}
            strandedLayers={[...new Set(strandedNow.flatMap((lost) => lost.was.map((was) => layout.layers.find((l) => l.id === was.layerId)?.name ?? "another layer")))]}
            drops={drops}
            placements={placements}
            placing={placing?.function ?? null}
            onDrop={(fns) => setDrops((previous) => new Set([...previous, ...fns]))}
            onKeep={(fn) => setDrops((previous) => new Set([...previous].filter((candidate) => candidate !== fn)))}
            onPlace={(lost) => {
              const placeable = placeableBinding(layout, lost);
              if (placeable !== null) onPlace({ function: lost.function, binding: placeable });
            }}
            onCancelPlace={() => onPlace(null)}
            onUnplace={onUnplace}
          />
        )}
        {binding === null ? null : (
          <Validation layout={layout} slot={slot} idleNote="" state={check.state} onRecheck={check.recheck} hideLost />
        )}
        {binding === null ? null : (
          <div className="editor-reason">
            <label htmlFor={reasonId}>Why this change? <span className="muted">Optional</span></label>
            <input id={reasonId} value={reason} maxLength={300} placeholder="So you remember it later" onChange={(event) => setReason(event.target.value)} />
          </div>
        )}
      </fieldset>

      <footer className="panel-foot">
        {footerExtra}
        <div className="panel-foot-note" aria-live="polite">
          {confirmingNative ? (
            <p className="blocked" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              keyloom can&apos;t edit this key&apos;s custom behaviour. Replacing it removes that behaviour.
            </p>
          ) : blocked ? (
            <p className="blocked">
              <TriangleAlert size={16} aria-hidden="true" />
              Apply or reset this change before editing another key.
            </p>
          ) : applyError !== null ? (
            <p className="blocked" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              {applyError}
            </p>
          ) : (
            <p className="muted">{whyNot ?? summary ?? "Nothing is saved until you apply."}</p>
          )}
        </div>
        {dirty ? (
          <button
            type="button"
            className="button"
            disabled={applying}
            onClick={() => {
              update(initial as Draft);
              setPicker(null);
            }}
          >
            Reset
          </button>
        ) : null}
        <button type="button" className="button button-primary" disabled={!canApply} aria-describedby={whyNot === null ? undefined : "apply-why"} onClick={() => void apply()}>
          {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
          {applyLabel}
          {applying ? null : <kbd aria-hidden="true">↵</kbd>}
        </button>
        {whyNot === null ? null : <span id="apply-why" className="sr-only">{whyNot}</span>}
      </footer>
    </section>
  );
}

// The history entry says what was kept and dropped as well as what the key became, so the undo button names all of it.
function withChoices(summary: string, layout: Layout, placements: readonly Placement[], drops: ReadonlySet<string>): string {
  const kept = placements.map((p) => `${functionName(p.function, layout)} moved to ${keyName(layout, p.slot)}`);
  const dropped = [...drops].map((fn) => `${functionName(fn, layout)} dropped`);
  const full = [summary, ...kept, ...dropped].join("; ");
  return full.length <= 200 ? full : `${full.slice(0, 199)}…`;
}

function transparentNote(layout: Layout, layerId: string): string {
  const base = layout.layers[0]?.name ?? "the base layer";
  return layerId === layout.layers[0]?.id
    ? "Does nothing here: there is no layer beneath the base layer to fall through to."
    : `Falls through to ${base}, so this key does whatever ${base} does in the same place.`;
}

function tapSlotText(draft: Draft, layout: Layout): string {
  const layerName = (id: string | null) => layout.layers.find((layer) => layer.id === id)?.name ?? "a layer";
  switch (draft.kind) {
    case "key":
      return draft.key.code === null ? "Choose a key" : keyWords(draft.key.code, draft.key.mods);
    case "holdTap":
      return draft.tap.code === null ? "Choose a key" : keyWords(draft.tap.code, draft.tap.mods);
    case "modifier":
      return draft.modifier.length === 0 ? "Choose a modifier" : modsWords(draft.modifier);
    case "layer":
      return draft.layerId === null ? "Choose a layer" : bindingSummary({ kind: "layer", action: draft.layerAction, layerId: draft.layerId }, layout) || layerName(draft.layerId);
    case "macro":
      return draft.macroId === null ? "Choose a macro" : bindingSummary({ kind: "macro", macroId: draft.macroId }, layout);
    case "transparent":
      return "Transparent";
    case "none":
      return "Nothing";
    case "tapDance":
      // The panel edits a tap dance's slots in the next part of rung 14; until then it shows the dance and leaves it alone.
      return bindingSummary(draft.tapDance as Binding, layout);
    case "native":
      return draft.native?.label ?? "Custom";
  }
}

function holdSlotText(draft: Draft, layout: Layout): string {
  if (draft.holdType === "layer") return layout.layers.find((layer) => layer.id === draft.holdLayerId)?.name ?? "Choose a layer";
  return draft.holdMods.length === 0 ? "Choose a modifier or layer" : modsWords(draft.holdMods);
}

// The picker's selected tiles are what the slot holds now.
function selectedIdsFor(slot: SlotName, draft: Draft): string[] {
  if (slot === "hold") {
    if (!hasHold(draft)) return [];
    return draft.holdType === "layer" && draft.holdLayerId !== null ? [`layer-${draft.holdLayerId}`] : draft.holdMods.map((mod) => `key-${MODIFIER_KEY[mod]}`);
  }
  switch (draft.kind) {
    case "key":
      return draft.key.code === null ? [] : [`key-${draft.key.code}`];
    case "holdTap":
      return draft.tap.code === null ? [] : [`key-${draft.tap.code}`];
    case "modifier":
      return draft.modifier.map((mod) => `key-${MODIFIER_KEY[mod]}`);
    case "layer":
      return draft.layerId === null ? [] : [`layer-${draft.layerId}`];
    case "macro":
      return draft.macroId === null ? [] : [`macro-${draft.macroId}`];
    case "transparent":
      return ["special-transparent"];
    case "none":
      return ["special-none"];
    case "tapDance":
    case "native":
      return [];
  }
}

const MODIFIER_KEY: Readonly<Record<Mod, string>> = {
  LCTL: "LEFT_CTRL", LSFT: "LEFT_SHIFT", LALT: "LEFT_ALT", LGUI: "LEFT_GUI", RCTL: "RIGHT_CTRL", RSFT: "RIGHT_SHIFT", RALT: "RIGHT_ALT", RGUI: "RIGHT_GUI",
};

// The eight modifier toggles, folded away until the key has modifiers or the person asks (the picker already offers each one).
function Mods({ legend, prompt, mods, hidden, onToggle }: { legend: string; prompt: string; mods: readonly Mod[]; hidden: boolean; onToggle: (mod: Mod) => void }) {
  const [open, setOpen] = useState(mods.length > 0);
  if (hidden) return null;
  if (!open) {
    return (
      <button type="button" className="slot-add" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        {prompt}
      </button>
    );
  }
  return <ModifierToggles legend={legend} mods={mods} onToggle={onToggle} />;
}

function SlotRow({
  label, value, open, onToggle, onClear, clearLabel, code,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  onClear?: () => void;
  clearLabel?: string;
  code?: string | undefined;
}) {
  return (
    <div className="slot" data-open={open}>
      <button type="button" className="slot-main" aria-expanded={open} onClick={onToggle}>
        <span className="slot-label">{label}</span>
        <span className="slot-value">{value}</span>
        {code === undefined ? null : <code className="slot-code">{code}</code>}
      </button>
      {onClear === undefined ? null : (
        <button type="button" className="icon-button" aria-label={clearLabel ?? "Clear"} onClick={onClear}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// The feel of a hold-tap in one sentence, with Tune (the rung 6 profile editor) and a way to pick
// another profile. Profiles are told apart by what they are for and by what differs between them.
function Timing({
  layout, profile, profileId, holdLayer, choosing, onChoosing, onProfile, tuning, onTuning, savedHoldTap, tuneBlockedReason, tuner,
}: {
  layout: Layout;
  profile: HoldTapProfile | undefined;
  profileId: string | null;
  holdLayer: boolean;
  choosing: boolean;
  onChoosing: (value: boolean) => void;
  onProfile: (id: string) => void;
  tuning: boolean;
  onTuning: (value: boolean) => void;
  savedHoldTap: Binding | null;
  tuneBlockedReason: string | null;
  tuner: ReactNode;
}) {
  const profiles = layout.holdTapProfiles;
  const apart = distinguishingWords(profiles);
  if (profiles.length === 0) {
    return <p className="form-note">This layout has no hold-tap timing profile, so a hold can&apos;t be made here yet.</p>;
  }
  const words = profile === undefined ? [] : profileWords(profile);
  return (
    <section className="timing" aria-label="How the hold feels">
      <p className="timing-sentence">
        <span className="timing-label">Feels like</span>
        <strong>{profile?.name ?? "No profile chosen"}</strong>
        {words.length === 0 ? null : <span className="muted">{words.map((word) => word.toLowerCase()).join(", ")}</span>}
      </p>
      <div className="timing-actions">
        <button
          type="button"
          className="button"
          aria-expanded={tuning}
          disabled={tuneBlockedReason !== null && !tuning}
          title={tuneBlockedReason ?? "Change how long a hold takes and when it counts"}
          onClick={() => onTuning(!tuning)}
        >
          Tune
        </button>
        {profiles.length > 1 ? (
          <button type="button" className="button" aria-expanded={choosing} onClick={() => onChoosing(!choosing)}>
            {choosing ? "Keep this profile" : "Change profile"}
          </button>
        ) : null}
      </div>
      {tuneBlockedReason !== null ? <p className="muted timing-why">{tuneBlockedReason}</p> : null}
      {choosing ? (
        <ChoiceGroup
          legend={holdLayer ? "Timing for a layer hold" : "Timing profile"}
          variant="cards"
          value={profileId}
          choices={profiles.map((candidate) => {
            const uses = usersOf(layout, candidate.id).length;
            const differing = apart.get(candidate.id) ?? [];
            return {
              value: candidate.id,
              label: candidate.name,
              hint: [uses === 0 ? "Not used yet" : `Used by ${uses} ${uses === 1 ? "key" : "keys"}`, ...differing.map((word) => word.toLowerCase())].join(" · "),
            };
          })}
          onChange={onProfile}
        />
      ) : null}
      {tuning && savedHoldTap !== null ? tuner : null}
    </section>
  );
}

const macroIdOf = (action: SlotAction | null | undefined): string | null => (action?.kind === "macro" ? action.macroId : null);

// The picker's selected tiles for a slot action.
function slotSelectedIds(action: SlotAction): string[] {
  switch (action.kind) {
    case "key": return [`key-${action.code}`];
    case "modifier": return action.mods.map((mod) => `key-${MODIFIER_KEY[mod]}`);
    case "layer": return [`layer-${action.layerId}`];
    case "macro": return [`macro-${action.macroId}`];
  }
}

/** The tapping term the firmware uses when a dance sets none: the layout's own TAPPING_TERM, else 200 ms (ZMK has no global one). */
function defaultTermMs(layout: Layout): number {
  const setting = layout.settings.find((candidate) => candidate.firmware === layout.firmware && candidate.key === "TAPPING_TERM");
  return typeof setting?.value === "number" ? setting.value : 200;
}

// A tap dance's feel in one sentence: it waits a term for the next tap, and the term can be set here.
function DanceTiming({
  term, fallback, hasHold, others, forAll, onTerm, onForAll,
}: {
  term: number | null;
  fallback: number;
  hasHold: boolean;
  others: number;
  forAll: boolean;
  onTerm: (ms: number | null) => void;
  onForAll: (value: boolean) => void;
}) {
  const id = useId();
  const ms = term ?? fallback;
  return (
    <section className="dance-timing" aria-label="How the tap dance feels">
      <p className="timing-sentence">
        <span className="timing-label">Feels like</span>
        <strong>A tap dance</strong>
        <span className="muted">waits {ms} ms for the next tap{hasHold ? " and for a hold" : ""}</span>
      </p>
      <div className="dance-term">
        <label htmlFor={id}>Tapping term</label>
        <input
          id={id}
          type="number"
          min={1}
          step={10}
          inputMode="numeric"
          value={term ?? ""}
          placeholder={String(fallback)}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            onTerm(Number.isFinite(value) && value >= 1 ? Math.round(value) : null);
          }}
        />
        <span className="muted">ms{term === null ? ", the keyboard's own" : ""}</span>
      </div>
      {others === 0 ? null : (
        <label className="dance-shared">
          <input type="checkbox" checked={forAll} onChange={(event) => onForAll(event.target.checked)} />
          <span>
            {others} other {others === 1 ? "key uses" : "keys use"} this tap dance. {forAll ? "Changing it for every key that uses it." : "Changing it for this key only."}
          </span>
        </label>
      )}
    </section>
  );
}
