import { keyIn } from "../../validation/words.ts";
import { LoaderCircle, Plus, Timer, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
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
import type { KeycapColour } from "../../boards/schema.ts";
import { layerDisplayName } from "../../layout/cap-words.ts";
import { applyWords, cardTitle, keyPhrase, macMeaning, slotPhrase } from "../card/card-words.ts";
import { layerLight } from "../light/layer-light.ts";
import { capMods } from "../../layout/cap-words.ts";
import { tapSlotAction } from "./dance.ts";
import { HeroCap, type HeroSlot } from "../card/HeroCap.tsx";
import { CardMods } from "../card/CardMods.tsx";
import type { Slot } from "../../layout/change.ts";
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
import "../card/card.css";

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
  /** The draft as the panel holds it, so the page can keep it when the card closes and give it back when the key opens (D-317). */
  snapshot: () => Draft | null;
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
  /** A draft kept from an earlier visit to this key (D-317); the panel opens on it instead of the key as applied. */
  resume?: Draft | null | undefined;
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
  /** Icon actions in the card's header that act on this key outside its draft: swap, copy, paste, colour (16#moving-and-copying-keys). */
  actions?: ReactNode;
  /** A notice that belongs to this key, such as the offer to read an old tap dance into keyloom. */
  notice?: ReactNode;
  /** The physical cap colour, LED and layer light, so the hero looks like the key on the board. */
  keycap?: KeycapColour | undefined;
  led?: string | undefined;
  reach?: string | null | undefined;
  /** Points at another key with the same function ("Also on Colemak"), so the board can light it; null stops. */
  onPointAt?: (slot: Slot | null) => void;
  handle?: Ref<KeyPanelHandle>;
}

type OpenPicker = { slot: SlotName; tab: PickerTab } | null;

// The panel remembers nothing between keys: it is keyed by key and revision, so a new key or an
// applied change starts it fresh from the saved layout.
export function KeyPanel(props: Props) {
  const {
    token, layoutRef, layout, revisionId, layerId, position, finger, homeRow, advanced, autoFocus, blocked, onDraft, resume, placements, placing,
    onPlace, onUnplace, onClose, onApplied, onTuned, onStale, onShowLayer, actions, notice, keycap, led, reach, onPointAt, handle,
  } = props;
  const layerIndex = layout.layers.findIndex((layer) => layer.id === layerId);
  const layer = layout.layers[layerIndex];
  const original = layer?.bindings[position];
  // A macro that only taps one key with modifiers (Oryx's way of sending ⇧⌘4) is shown and edited as that key; it stays a macro until
  // something on the card changes (P2 review).
  const macroAsKey = useMemo<Binding | null>(() => {
    if (original?.kind !== "macro") return null;
    const steps = layout.macros.find((macro) => macro.id === original.macroId)?.steps ?? [];
    const only = steps[0];
    return steps.length === 1 && only?.op === "tap" && only.code !== undefined ? { kind: "key", code: only.code, ...(only.mods === undefined ? {} : { mods: only.mods }) } : null;
    // Read once, like the draft below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initial = useMemo(
    () => (original === undefined ? null : draftFromBinding(macroAsKey ?? original, layout, layerId)),
    // The panel is keyed by key and revision, so the layout it opened on is the one it edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // A kept draft opens where it was left; `initial` stays the key as applied, so the panel still knows it is a change.
  const [draft, setDraft] = useState<Draft | null>(() => resume ?? initial);
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
  // Quiet by default (P2 review): the hold's timing opens from the picker's header, the dance's wait from its chip, a reason from a link.
  const [timingOpen, setTimingOpen] = useState(false);
  const [waitOpen, setWaitOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  // The hold opens on the comp's two groups, modifiers and layers; every key is one link away.
  const [holdAll, setHoldAll] = useState(false);
  useEffect(() => {
    setFocusPicker(false);
    // After an apply the panel is made again from the saved layout, and the focus that was in the old one is gone.
    const active = document.activeElement;
    if (picker === null && (active === null || active === document.body)) root.current?.focus({ preventScroll: true });
    // Only on mount: later focus belongs to what the person is doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The handle outlives renders, so it calls through a ref to the latest apply and closePicker.
  const latest = useRef({ apply: () => {}, closePicker: (): boolean => false, snapshot: (): Draft | null => null });
  useImperativeHandle(handle, () => ({ apply: () => latest.current.apply(), closePicker: () => latest.current.closePicker(), snapshot: () => latest.current.snapshot() }), []);

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
  const changed = planned !== null && planned.after !== null && !deepEqual(planned.after, layout) && !(macroAsKey !== null && draftBinding !== null && deepEqual(draftBinding, macroAsKey));
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
  function setMacro(slotName: SlotName, macro: Macro) {
    update((previous) => {
      const withMacro = { ...previous, pendingMacros: [...previous.pendingMacros.filter((m) => m.id !== macro.id), macro] };
      if (slotName === "tap") return pickTap(withMacro, { t: "macro", macroId: macro.id });
      return isExtraSlot(slotName) ? setExtraSlot(withMacro, slotName as ExtraSlot, { kind: "macro", macroId: macro.id }, layout, slot) : previous;
    });
  }

  function closeMacroPicker() {
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

  // Opening a picker brings it into view inside the card, which may be short in a small window.
  const pickerSlot = picker?.slot ?? null;
  useEffect(() => {
    if (pickerSlot === null) return;
    const frame = window.requestAnimationFrame(() => root.current?.querySelector(".card-picker")?.scrollIntoView({ block: "nearest" }));
    return () => window.cancelAnimationFrame(frame);
  }, [pickerSlot]);

  if (draft === null || layer === undefined || original === undefined) return null;

  const incomplete = incompleteReason(draft, layout);
  const summary = binding === null ? null : withChoices(changeSummary(after ?? layout, layerId, position, binding, layout), after ?? layout, placements, drops);
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

  latest.current = { apply: () => void apply(), closePicker, snapshot: () => draft };

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
  const ctx = { layers: drawn.layers, macros: drawn.macros, tapDances: drawn.tapDances, passthrough: drawn.passthrough };
  const shownLegend = bindingLegend(binding ?? draftBinding ?? original, ctx);
  const shownTone = (binding ?? draftBinding ?? original).kind;
  const whyNot =
    binding === null
      ? dirty ? (incomplete ?? "This is the same as the key now.") : null
      : check.state.status === "checking"
        ? "Checking the change."
        : result !== null && !result.ok
          ? lostNow.length > 0 && lostNow.every((row) => drops.has(row.lost.function) || placements.some((p) => p.function === row.lost.function)) === false
            ? `Drop ${lostNow.map((row) => functionName(row.lost.function, layout)).join(" and ")} or put it somewhere first.`
            : "Fix the problems above first."
          : null;

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
          // The person just chose the Macros tab, so the search for the first key is where they type next.
          autoFocus
          onChange={(macro) => setMacro(slotName, macro)}
          onDone={closeMacroPicker}
          onUse={(macroId) => pick(slotName, { t: "macro", macroId })}
        />
      ),
    };
  }

  const timingSection = draft === null || original === undefined ? null : (
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
                <ProfileTuner token={token} layoutRef={layoutRef} layout={layout} revisionId={revisionId} slot={slot} binding={original} onApplied={onTuned} onStale={onStale} />
              ) : null
            }
          />
  );

  // The one picker, for whichever slot is open (16#one-picker-for-every-slot), under the cap.
  function openSlotPicker() {
    if (picker === null || draft === null) return null;
    const which = picker.slot;
    const extra = isExtraSlot(which) ? (draft[which as ExtraSlot] ?? null) : null;
    const selected = which === "tap" ? selectedTap : which === "hold" ? selectedHold : new Set(extra === null ? [] : slotSelectedIds(extra));
    const clear =
      which === "hold" && hasHold(draft)
        ? { label: "Remove the hold", run: () => update((previous) => clearHold(previous)) }
        : isExtraSlot(which) && extra !== null
          ? { label: which === "doubleTap" ? "Remove the double tap" : "Remove tap, then hold", run: () => update((previous) => clearExtraSlot(previous, which as ExtraSlot)) }
          : null;
    const holdGroups = which === "hold" && !holdAll && !advanced;
    return (
      <div className="card-picker">
        <div className="card-picker-head">
          <b>{SLOT_TITLE[which]}</b>
          {which === "hold" && hasHold(draft) && !isDance(draft) && profile !== undefined ? (
            <button type="button" className="link-button" aria-expanded={timingOpen} onClick={() => setTimingOpen((open) => !open)}>
              {profile.name} timing
            </button>
          ) : null}
          {clear === null ? null : (
            <button type="button" className="link-button" onClick={() => { clear.run(); setPicker(null); }}>
              {clear.label}
            </button>
          )}
        </div>
        {holdGroups ? <HoldGroups draft={draft} layout={layout} layerId={layerId} onMods={chooseHoldMods} onLayer={(id) => chooseHoldLayer(id)} onAll={() => setHoldAll(true)} /> : null}
        {holdGroups ? null : <SlotPicker
          slot={which}
          tab={picker.tab}
          onTab={(tab) => setPicker({ slot: which, tab })}
          layout={layout}
          layerId={layerId}
          keysOnly={which === "hold" ? true : which === "tap" ? keysOnly : false}
          advanced={advanced}
          selectedIds={selected}
          initialLayerAction={which === "tap" ? draft.layerAction : which === "hold" ? "momentary" : extra?.kind === "layer" ? extra.action : "toggle"}
          autoFocus={focusPicker}
          token={token}
          layoutRef={layoutRef}
          position={position}
          onPick={(choice) => pick(which, choice)}
          onUseBinding={
            which === "tap"
              ? (parsed) => {
                  update(draftFromBinding(parsed, layout, layerId));
                  setPicker(null);
                  root.current?.focus({ preventScroll: true });
                }
              : () => {}
          }
          {...macroPaneFor(which)}
        />}
        {which === "hold" && timingOpen && hasHold(draft) && !isDance(draft) ? timingSection : null}
      </div>
    );
  }

  // The hold's two groups keep the picker open, so the choice shows lit in place, as in the comp.
  function chooseHoldMods(mods: Mod[]) {
    update((previous) => {
      const next = pickHold(previous, { t: "mods", mods });
      return profileTouched ? next : { ...next, profileId: profileFor(layout, "mods", homeRow) };
    });
  }
  function chooseHoldLayer(id: string) {
    update((previous) => {
      const next = pickHold(previous, { t: "layer", layerId: id });
      return profileTouched ? next : { ...next, profileId: profileFor(layout, "layer", homeRow) };
    });
  }

  // Opening a part of the cap opens its picker; a hold or an extra slot that isn't there yet is added first.
  function openRegion(region: HeroSlot) {
    if (draft === null) return;
    if (region === "tap") return openPicker("tap", draft.kind === "macro" && picker?.slot !== "tap" ? "macro" : undefined);
    if (region === "hold") {
      if (!hasHold(draft)) {
        update((previous) => addHold(previous, profileFor(layout, "mods", homeRow)));
        setFocusPicker(true);
        setPicker({ slot: "hold", tab: "modifiers" });
        return;
      }
      return openPicker("hold");
    }
    setFocusPicker(true);
    setPicker((open) => (open?.slot === region ? null : { slot: region, tab: "letters" }));
  }

  // The four modifiers beside the cap act on the slot being edited: what the tap sends with it, or what the hold holds.
  const modTarget: { mods: readonly Mod[]; toggle: (mod: Mod) => void; label: string } | null = (() => {
    if (picker?.slot === "hold" && draft.holdType === "mods") return { mods: draft.holdMods, toggle: (mod: Mod) => update((previous) => toggleHoldMod(previous, mod)), label: "Held together" };
    if (picker !== null && isExtraSlot(picker.slot)) {
      const action = draft[picker.slot as ExtraSlot];
      if (action === null || !canToggleSlotMods(action)) return null;
      const which = picker.slot as ExtraSlot;
      return { mods: slotMods(action), toggle: (mod: Mod) => update((previous) => (previous[which] === null ? previous : { ...previous, [which]: toggleSlotMod(previous[which] as SlotAction, mod) })), label: "Sent with it" };
    }
    if (canToggleTapMods(draft)) return { mods: tapMods(draft), toggle: (mod: Mod) => update((previous) => toggleTapMod(previous, mod)), label: tap === "modifier" ? "Modifiers" : "Sent with it" };
    return null;
  })();

  const holdRegion = draft.kind === "native" || draft.kind === "macro" ? null : hasHold(draft) ? (draft.holdType === "mods" ? draft.holdMods.length === 0 : draft.holdLayerId === null) ? { text: null, ghost: "hold…", name: "When held" } : { text: shownLegend.hold ?? holdText, name: "When held" } : canAddHold(draft) ? { text: null, ghost: "hold…", name: "When held" } : null;
  const extras = draft.kind !== "macro" && draft.kind !== "native" && (canAddExtraSlot(draft) || isDance(draft));
  const doubleRegion = !extras ? null : draft.doubleTap === null ? { text: null, ghost: "2×", name: "When double-tapped" } : { text: `2× ${shownLegend.double ?? ""}`.trim(), name: "When double-tapped" };
  const thenHoldRegion = !extras ? null : draft.tapThenHold === null ? { text: null, ghost: "tap+hold", name: "When tapped, then held" } : { text: "tap+hold ●", name: "When tapped, then held" };
  const title = cardTitle(shownBinding ?? original, drawn);
  const where2 = [finger === undefined ? undefined : `${finger.replace("-", " ")} finger`, layerDisplayName(layer.name)].filter(Boolean).join(" · ");
  const showFoot = dirty || blocked || applyError !== null || confirmingNative || applying;
  const applyText = applying ? "Applying" : confirmingNative ? "Replace and apply" : binding === null ? "Apply" : applyWords(original, binding, drawn);
  const before = current?.headline ?? "";
  const lowered = `${before.charAt(0).toLowerCase()}${before.slice(1)}`;
  // A firmware-only key and a macro say what they do in their own words; their headlines quote firmware names (D-270).
  const restSentence =
    draft.kind === "native" ? "" : draft.kind === "macro" ? macroSentence(layout.macros.find((macro) => macro.id === draft.macroId)) : null;
  const dance = isDance(draft) ? danceSentence(draft, drawn, draft.danceTermMs ?? defaultTermMs(layout)) : null;
  const meaning = draft.kind === "key" && draft.key.code !== null ? macMeaning(draft.key.code, draft.key.mods, shownLegend.tap) : null;
  const layerLine =
    draft.kind === "layer" && draft.layerId !== null
      ? (() => {
          const name = layerDisplayName(layout.layers.find((candidate) => candidate.id === draft.layerId)?.name ?? "the layer");
          return { momentary: `Hold for ${name}.`, toggle: `Tap to turn ${name} on or off.`, to: `Tap to go to ${name}.`, oneShot: `Tap for ${name}, for the next key only.` }[draft.layerAction];
        })()
      : null;
  const sentence = dirty && binding !== null ? (restSentence === null ? `Before: ${lowered}` : "") : dance !== null ? dance : layerLine !== null ? layerLine : meaning !== null ? meaning : restSentence !== null ? restSentence : draft.kind === "key" || draft.kind === "holdTap" || draft.kind === "transparent" || draft.kind === "none" ? (picker === null ? "Press a key on your keyboard to put it here." : "") : (current?.headline ?? "");
  // One chip per place, named by where it is; two functions on the same other key, or two keys on the same other layer, are one chip.
  const chipName = (other: Slot) => (other.layerId === layerId ? keyIn(layout, other).replace(/ on .*$/, "") : `on ${layerDisplayName(layout.layers.find((candidate) => candidate.id === other.layerId)?.name ?? "")}`);
  const also = where
    .flatMap((entry) => entry.others)
    // Only other layers: a duplicate on this layer is in view on the board already.
    .filter((other) => other.layerId !== layerId)
    .filter((other, i, all) => all.findIndex((x) => chipName(x) === chipName(other)) === i)
    .slice(0, draft.kind === "layer" ? 2 : 3);
  const lightOf = (id: string) => {
    const index = layout.layers.findIndex((candidate) => candidate.id === id);
    return index < 0 ? null : layerLight(layout.layers, index, layout.layers[index]?.bindings.length ?? 0);
  };
  // The slots this change touches, lit on the hero; everything else stays as it was.
  const originalLegend = bindingLegend(macroAsKey ?? original, { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances, passthrough: layout.passthrough });
  const changedSlots = new Set<HeroSlot>(
    binding === null
      ? []
      : ([
          shownLegend.tap !== originalLegend.tap ? "tap" : null,
          shownLegend.hold !== originalLegend.hold ? "hold" : null,
          shownLegend.double !== originalLegend.double ? "doubleTap" : null,
          shownLegend.tapHold !== originalLegend.tapHold ? "tapThenHold" : null,
        ].filter((slot) => slot !== null) as HeroSlot[]),
  );

  return (
    <section ref={root} tabIndex={-1} className="key-panel key-card" aria-label={advanced ? `Key ${position + 1}: ${title}` : title} onKeyDown={onKeyDown}>
      <header className="card-head">
        <div className="card-heading">
          <h2>{title}</h2>
          <p>{where2}{advanced ? ` · key ${position + 1}` : ""}</p>
        </div>
        <div className="card-tools">
          {actions}
          <button type="button" className="card-icon" aria-label="Close the key card" title="Close (Esc)" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="card-scroll">
      <fieldset className="card-body" disabled={applying}>
        <div className="card-hero">
          <HeroCap
            legend={advancedText ?? shownLegend}
            tone={shownTone}
            keycap={keycap}
            led={led}
            reach={reach}
            hold={holdRegion}
            staticFront={holdRegion === null ? (shownLegend.hold ?? null) : null}
            doubleTap={doubleRegion}
            tapThenHold={thenHoldRegion}
            open={picker === null ? null : (picker.slot as HeroSlot)}
            draft={binding !== null}
            changed={changedSlots}
            onOpen={openRegion}
            label={current?.headline ?? ""}
            // While a picker is open the key steps down, so the picker shows in a short window (P2 review).
            size={picker === null ? 112 : 84}
          />
          {modTarget === null ? null : <CardMods mods={modTarget.mods} onToggle={modTarget.toggle} label={modTarget.label} />}
          {draft.kind === "layer" && picker === null ? (
            <div className="card-mods" role="radiogroup" aria-label="What the key does with the layer">
              {LAYER_ACTION_CHOICES.map(({ value, mark, word }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  className="card-mod"
                  aria-checked={draft.layerAction === value}
                  aria-label={word}
                  title={word}
                  onClick={() => update((previous) => ({ ...previous, layerAction: value }))}
                >
                  {mark}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Empty slots get named buttons: the cap's corners are too small for words, and hidden corners went unfound (BK, 2026-10-16). */}
        {picker === null && (doubleRegion?.text === null || thenHoldRegion?.text === null) ? (
          <div className="card-slots" role="group" aria-label="Add to this key">
            {doubleRegion?.text === null ? (
              <button type="button" className="card-slot-add" onClick={() => openRegion("doubleTap")}>
                <Plus size={13} aria-hidden="true" /> Double tap
              </button>
            ) : null}
            {thenHoldRegion?.text === null ? (
              <button type="button" className="card-slot-add" onClick={() => openRegion("tapThenHold")}>
                <Plus size={13} aria-hidden="true" /> Tap, then hold
              </button>
            ) : null}
          </div>
        ) : null}
        {sentence === "" || (draft.kind === "macro" && picker === null && !dirty) ? null : <p className="card-sentence" aria-live="polite">{sentence}</p>}
        {draft.kind === "macro" && picker === null && !dirty ? <MacroSteps macro={layout.macros.find((macro) => macro.id === draft.macroId)} /> : null}
        {draft.kind === "native" && draft.native !== null ? (
          <p className="card-note">
            keyloom keeps this key as your firmware wrote it. Picking something else replaces it.
            {advanced ? <code className="card-code">{draft.native.source}</code> : null}
          </p>
        ) : null}
        {draft.kind === "tapDance" ? <p className="card-note">This tap dance has a slot the card can&apos;t show yet, such as a hold that toggles a layer. It is left as it is; the chat or the CLI can change it.</p> : null}
        {draft.kind === "transparent" ? <p className="card-note">{transparentNote(layout, layerId)}</p> : null}
        {notice}

        {also.length > 0 || (draft.kind === "layer" && draft.layerId !== null) || isDance(draft) ? (
          <div className="card-chips">
            {isDance(draft) ? (
              <button type="button" className="card-chip" aria-expanded={waitOpen} onClick={() => setWaitOpen((open) => !open)}>
                <Timer size={13} aria-hidden="true" />
                Tune the wait
              </button>
            ) : null}
            {draft.kind === "layer" && draft.layerId !== null ? (
              <button type="button" className="card-chip" onClick={() => onShowLayer(draft.layerId as string)}>
                {(() => {
                  const light = lightOf(draft.layerId as string);
                  return light === null ? null : <i className="card-chip-dot" style={{ "--dot": light } as CSSProperties} aria-hidden="true" />;
                })()}
                Show {layerDisplayName(layout.layers.find((candidate) => candidate.id === draft.layerId)?.name ?? "the layer")}
              </button>
            ) : null}
            {also.map((other) => (
              <button
                key={`${other.layerId}:${other.position}`}
                type="button"
                className="card-chip"
                title={`Show it on ${layerDisplayName(layout.layers.find((candidate) => candidate.id === other.layerId)?.name ?? "")}`}
                onPointerEnter={() => onPointAt?.(other)}
                onPointerLeave={() => onPointAt?.(null)}
                onFocus={() => onPointAt?.(other)}
                onBlur={() => onPointAt?.(null)}
                onClick={() => onShowLayer(other.layerId)}
              >
                {(() => {
                  const light = lightOf(other.layerId);
                  return light === null ? null : <i className="card-chip-dot" style={{ "--dot": light } as CSSProperties} aria-hidden="true" />;
                })()}
                Also {chipName(other)}
              </button>
            ))}
          </div>
        ) : null}

        {openSlotPicker()}
        {advanced && modTarget !== null ? <ModifierToggles legend={`${modTarget.label}, by side`} mods={modTarget.mods} onToggle={modTarget.toggle} /> : null}

        {isDance(draft) && waitOpen ? (
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
        {/* Only what needs saying: problems, warnings, or a check that couldn't run. A clean change says nothing; Apply is enough. */}
        {binding === null || !(check.state.status === "error" || (check.state.status === "done" && (!check.state.result.ok || check.state.result.warnings.length > 0))) ? null : (
          <Validation layout={layout} slot={slot} idleNote="" state={check.state} onRecheck={check.recheck} hideLost />
        )}
        {binding === null || !(reasonOpen || reason !== "") ? null : (
          <div className="card-reason">
            <input id={reasonId} aria-label="Why this change" value={reason} maxLength={300} placeholder="Why this change? So you remember it later" autoFocus={reasonOpen && reason === ""} onChange={(event) => setReason(event.target.value)} />
          </div>
        )}
      </fieldset>
      </div>

      {showFoot ? (
        <footer className="card-foot">
          {confirmingNative || blocked || applyError !== null || (whyNot !== null && binding !== null) ? (
            <p className="card-foot-note" role={applyError !== null || confirmingNative ? "alert" : undefined}>
              <TriangleAlert size={14} aria-hidden="true" />
              {confirmingNative
                ? "keyloom can't edit this key's custom behaviour. Replacing it removes that behaviour."
                : blocked
                  ? "Apply or discard this change before editing another key."
                  : (applyError ?? whyNot)}
            </p>
          ) : null}
          <div className="card-foot-row">
            <button
              type="button"
              className="card-discard"
              disabled={applying}
              onClick={() => {
                update(initial as Draft);
                setPicker(null);
              }}
            >
              Discard
            </button>
            {binding === null || reasonOpen || reason !== "" ? <span /> : (
              <button type="button" className="link-button card-reason-link" onClick={() => setReasonOpen(true)}>
                Add a reason
              </button>
            )}
            <button type="button" className="card-apply" disabled={!canApply} title={warnings > 0 ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}, listed above` : summary ?? undefined} aria-describedby={whyNot === null ? undefined : "apply-why"} onClick={() => void apply()}>
              {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
              {applyText}
              {applying ? null : <kbd aria-hidden="true">↵</kbd>}
            </button>
          </div>
          {whyNot === null ? null : <span id="apply-why" className="sr-only">{whyNot}</span>}
        </footer>
      ) : null}
    </section>
  );
}

const LAYER_ACTION_CHOICES: readonly { value: Draft["layerAction"]; mark: string; word: string }[] = [
  { value: "oneShot", mark: "1×", word: "For the next key only" },
  { value: "momentary", mark: "⇣", word: "While held" },
  { value: "toggle", mark: "⇄", word: "Toggle on and off" },
  { value: "to", mark: "→", word: "Go to it" },
];

// A macro's steps in the card's words: "Sends Shift + Command + 4." or "Taps Command, waits 100 ms, then taps C."
function macroSentence(macro: Macro | undefined): string {
  if (macro === undefined || macro.steps.length === 0) return "";
  const parts = macro.steps.map((step) =>
    step.op === "waitMs" ? `waits ${step.ms} ms` : step.op === "text" ? `types “${step.text}”` : `${step.op === "tap" ? "taps" : step.op === "press" ? "presses" : "releases"} ${step.code === undefined ? "a key" : keyPhrase(step.code, step.mods)}`,
  );
  const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, then ${parts.at(-1)}`;
  return `${said?.charAt(0).toUpperCase()}${said?.slice(1)}.`;
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
        {/* Tuning works on a saved hold, so before Apply there is nothing to tune and the button isn't shown. */}
        {tuneBlockedReason !== null && !tuning ? null : (
          <button type="button" className="button" aria-expanded={tuning} title="Change how long a hold takes and when it counts" onClick={() => onTuning(!tuning)}>
            Tune
          </button>
        )}
        {profiles.length > 1 ? (
          <button type="button" className="button" aria-expanded={choosing} onClick={() => onChoosing(!choosing)}>
            {choosing ? "Keep this profile" : "Change profile"}
          </button>
        ) : null}
      </div>
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
  return (
    <section className="dance-timing" aria-label="How the tap dance feels">
      <div className="dance-term">
        <label htmlFor={id}>Waits</label>
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
        <span className="muted">ms for a second tap{hasHold ? " or a hold" : ""}{term === null ? ", your keyboard's own" : ""}</span>
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

const SLOT_TITLE: Record<SlotName, string> = { tap: "When tapped", hold: "When held", doubleTap: "When tapped twice", tapThenHold: "When tapped, then held" };

/** "Tap for Hyper + Space. Tap twice for [. It waits 200 ms for the second tap." (comp b2) */
function danceSentence(draft: Draft, layout: Layout, termMs: number): string {
  const tapAction = tapSlotAction(draft);
  const parts: string[] = [];
  // A no-break space keeps "for [." together; a one-character key alone at a line's start reads as stray punctuation.
  if (tapAction !== null) parts.push(`Tap for\u00a0${slotPhrase(tapAction, layout)}.`);
  if (draft.doubleTap !== null) parts.push(`Tap twice for\u00a0${slotPhrase(draft.doubleTap, layout)}.`);
  if (draft.tapThenHold !== null) parts.push(`Tap, then hold, for\u00a0${slotPhrase(draft.tapThenHold, layout)}.`);
  parts.push(`It waits ${termMs} ms for the second tap.`);
  return parts.join(" ");
}

// A macro's steps, as the comp lists them: "Sends, in order", one row per step.
function MacroSteps({ macro }: { macro: Macro | undefined }) {
  if (macro === undefined || macro.steps.length === 0) return null;
  return (
    <section className="card-steps" aria-label="Sends, in order">
      <h3>Sends, in order</h3>
      <ol>
        {macro.steps.map((step, i) => (
          <li key={i}>
            <span className="card-step-n">{i + 1}</span>
            {step.op === "waitMs" ? (
              <span className="card-step-wait">Wait {step.ms} ms</span>
            ) : step.op === "text" ? (
              <span>Type <b>“{step.text}”</b></span>
            ) : (
              <span>
                {step.op === "tap" ? "Tap" : step.op === "press" ? "Press" : "Release"} <b>{step.code === undefined ? "" : `${step.mods === undefined ? "" : capMods(step.mods)} ${keyPhrase(step.code)}`.trim()}</b>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// The hold's picker, as the comp draws it: the modifiers and the layers, then every key behind one link.
const HOLD_MODS: readonly { label: string; mark: string; mods: Mod[] }[] = [
  { label: "Control", mark: "⌃", mods: ["LCTL"] },
  { label: "Option", mark: "⌥", mods: ["LALT"] },
  { label: "Shift", mark: "⇧", mods: ["LSFT"] },
  { label: "Command", mark: "⌘", mods: ["LGUI"] },
  { label: "Hyper", mark: "✦", mods: ["LCTL", "LSFT", "LALT", "LGUI"] },
  { label: "Meh", mark: "◆", mods: ["LCTL", "LSFT", "LALT"] },
];

function HoldGroups({ draft, layout, layerId, onMods, onLayer, onAll }: { draft: Draft; layout: Layout; layerId: string; onMods: (mods: Mod[]) => void; onLayer: (id: string) => void; onAll: () => void }) {
  const held = draft.holdType === "mods" ? capMods(draft.holdMods) : null;
  return (
    <div className="hold-groups">
      <p className="hold-group-name">Modifier</p>
      <div className="hold-grid">
        {HOLD_MODS.map((choice) => (
          <button key={choice.label} type="button" className="hold-choice" aria-pressed={held !== null && held !== "" && held === capMods(choice.mods)} onClick={() => onMods(choice.mods)}>
            <span className="hold-mark" aria-hidden="true">{choice.mark}</span>
            {choice.label}
          </button>
        ))}
      </div>
      <p className="hold-group-name">Layer</p>
      <div className="hold-grid">
        {layout.layers.map((candidate, index) =>
          candidate.id === layerId ? null : (
            <button key={candidate.id} type="button" className="hold-choice" aria-pressed={draft.holdType === "layer" && draft.holdLayerId === candidate.id} onClick={() => onLayer(candidate.id)}>
              {(() => {
                const light = layerLight(layout.layers, index, candidate.bindings.length);
                return <i className="card-chip-dot" data-unlit={light === null} style={light === null ? undefined : ({ "--dot": light } as CSSProperties)} aria-hidden="true" />;
              })()}
              {layerDisplayName(candidate.name)}
            </button>
          ),
        )}
      </div>
      <button type="button" className="link-button hold-all" onClick={onAll}>Any key…</button>
    </div>
  );
}
