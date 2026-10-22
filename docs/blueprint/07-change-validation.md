# 07: Change validation

Status: validator built. The audit closeout adds combo-conflict and ZMK identifier-clash checks, with table and integration regressions. Rules below describe code behavior, not new hardware evidence.

Every change set passes through one validator before BK sees it, and again before it's applied (D-014). The agent's output is a proposal, not a fact. Without the validator, the first sign of a broken layer would be a keyboard BK can't type on. The validator is a pure function in `src/validation/`:

```ts
validate(board: BoardDefinition, before: Layout, ops: ChangeOp[]): ValidationResult

type ValidationResult = {
  ok: boolean;                         // false if any error
  errors: Issue[];                     // block preview and apply
  warnings: Issue[];                   // shown; don't block
  diff: {
    changed: Slot[];                   // changed bindings/tap dances on layers present before and after
    displaced: { function: string; from: Slot; to: Slot | null }[];
    dropped: { function: string; reason: string }[];
    relearnCount: number;              // functions that moved position
    retuned: Slot[];                   // hold-tap keys whose binding is unchanged but whose feel changed (D-052)
    reminders: DecisionReminder[];     // 08
  };
};
type Issue = { code: string; message: string; plain?: string; slots?: Slot[]; function?: string; layerId?: string };
type DecisionReminder = { decisionId: string; goal: string; choice: string; reason: string; status: "hypothesis" | "tried_helpful"; slots: Slot[] };
```

Both the agent (`analyse_change`, `propose_changes`) and the editor call it. The CLI exposes it as `keyloom change check`.

## Errors

Errors make the change set invalid. The codes are stable strings that the agent sees, so it can fix the proposal.

An identical document-rule problem already present before the change is reported as a warning, so an imported layout stays editable. A newly added unreachable layer also warns while it is being filled in (D-181); making an existing reachable layer unreachable is an error. `stale_base` is checked by the app against revision history, not by the pure `validate` call alone.

| Code | Rule | Why |
|---|---|---|
| `schema` | Ops and resulting document parse with the zod schemas | Nothing malformed reaches firmware generation |
| `stale_base` | Ops touch a slot that changed since the change set's base revision | The proposal was made against a layout that no longer exists ([02](02-layout-model.md#applying-undoing-and-stale-bases)) |
| `binding_count` | Every layer has exactly `board.keyCount` bindings | Generated firmware would not compile |
| `unknown_ref` | Referenced layer IDs (including conditional-layer targets), macro IDs, hold-tap profiles, tap-dance IDs in layer bindings and combo outputs, and combo positions must exist | Dangling references are refused before generation |
| `function_lost` | Every function reachable before is reachable after, unless a `dropFunction` op names it | Principle 5: nothing gets lost silently (D-020) |
| `layer_unreachable` | Every layer can be reached from the base layer through layer actions, layer-taps or combos | A layer nobody can reach is a lost function |
| `conditional_layer_invalid` | A conditional layer names three different layers, and the layer it turns on is not one of the two it waits for | It could never fire (D-386) |
| `conditional_layer_blocked` | On QMK, no conditional layer sits beside kept code that defines `layer_state_set_user` | The generated function would be a second definition (D-386) |
| `layer_trap` | A layer entered with `toggle` or `to` has a binding that leads back | Otherwise the keyboard gets stuck on it |
| `firmware_unsupported` | Every binding kind and option exists in the board's firmware ([05](05-firmware-qmk.md), [06](06-firmware-zmk.md)). That includes hold-tap profile options: on QMK only `TAPPING_TERM`, `QUICK_TAP_TERM`, `PERMISSIVE_HOLD` and `HOLD_ON_OTHER_KEY_PRESS` can differ per profile, and keys with the same tap and hold must agree; on ZMK the flavor, millisecond and trigger-position values must be valid (D-057) | D-024. The firmware decides what's expressible |
| `qmk_modtap_basic` | On QMK, a hold-tap's tap side is a basic keycode with no mods | QMK limits `MT()` to basic keycodes (qmk/qmk_firmware `7a1bbf3` `docs/mod_tap.md:65`) |
| `qmk_modtap_mixed_hands` | On QMK, a mod-tap's mods are all left-hand or all right-hand | One right-hand mod makes all of them right-handed (same source) |
| `combo_conflict` | Two combos with overlapping layer scopes cannot use the same set of positions, regardless of order; `all` overlaps every scope | Only one could fire. One issue names both combos; combos have no slot of their own |
| `qmk_combo_tapdance` | A QMK combo cannot output a tap dance | QMK cannot run it as a combo result |
| `qmk_tapdance_mixed_hands` | A QMK tap-dance slot cannot mix left- and right-hand modifiers | The generated modified key cannot express that combination |
| `tap_dance_slot` | A tap dance cannot use a momentary layer in its tap slot | It ends with the tap, so never holds the layer on |
| `tap_dance_native_conflict` | Modelled QMK tap dances cannot coexist with kept Oryx tap-dance code | Both would own the same generated machinery; upgrade a recognised old layout first |
| `macro_text_untypable` | A macro text step must be typable on a US keyboard | The generator cannot send arbitrary Unicode text |
| `lighting_unsupported` | Physical LED lighting needs board support and valid key positions | The generator would omit unsupported colours; on-screen layer styling is separate |
| `remapper_lockout` | Escape and a Control key stay reachable on the built-in keyboard | Preserve a usable way out on the MacBook (D-247) |
| `passthrough_layer_index` | Kept firmware source and kept keys follow their layers: the importer records which numbers are layer numbers, and generation writes each as its layer's current index. The rule refuses a change that removes a layer the code names (it says which key or line), and one that renumbers layers while a line uses a layer number in a way that can't be rewritten (arithmetic, a bitmask, a comparison by order, a name no `#define` gives a number to). It names the line. A layout stored before the numbers were read keeps the old rule: only adding at the end passes (D-360) | Oryx's RGB and custom-key code and MoErgo's layer defines use layer numbers and would silently point at the wrong layers (S3) |
| `layer_limit` | The layer count stays within the firmware's limit, including `LAYER_STATE_8BIT` (8) where it's set | The firmware wouldn't compile, or layers above the cap would be unreachable (S3) |
| `native_edit` | A native binding may be moved, copied or replaced by a modelled binding, but no change may introduce native source it did not import. Passthrough blocks stay unchanged | There is no confirmation bypass for editing arbitrary firmware source (D-024) |

## Layer numbers in kept code

Reordering and deleting layers works on a layout with kept code because the importer records, for each kept source and each kept key, the number literals that are layer numbers (`layerRefs`, offsets into the source tied to a layer id) and the lines that name a layer in a way it can't prove (`unprovable`). The generators write each recorded number as its layer's index in the current order, so the stored source never changes (`native_edit` still compares it) and `src/layout/layer-refs.ts` stays pure. The importers find the positions with tree-sitter: QMK in `src/firmware/qmk/layer-refs.ts` (D-041) and ZMK through the devicetree grammar in `src/firmware/zmk/layer-refs.ts` (D-037). The rules for what counts as provable are shared in `src/layout/layer-ref-resolve.ts`.

A number is a layer number where the firmware or Oryx puts a layer. In QMK that is the layer argument of `LT`, `MO`, `TG`, `TO`, `OSL`, `TT`, `DF`, `LM`, `PDF`, `layer_move`, `layer_on`, `layer_off`, `layer_invert`, `IS_LAYER_ON`, `IS_LAYER_OFF`, `set_single_default_layer`, `set_single_persistent_default_layer`, `layer_state_cmp` and the tri-layer functions; a `case` label in a switch over `biton32(…)` or `get_highest_layer(…)`; an `==` or `!=` against either; a `ledmap[n]` index or `[n] =` row; and the argument of a function whose parameter indexes `ledmap` (Oryx's `set_layer_color(n)`). In ZMK it is the layer parameter of `&mo`, `&to`, `&tog`, `&sl`, `&lt`, `&magic`, `&layer_on_hold`, a kept hold-tap that holds with one of them, a kept behaviour with the momentary-layer, toggle-layer or to-layer compatible, and a kept sticky-key whose binding is one of those layer behaviours. The importer also reads behaviour calls inside macro bindings. The cells of `layers`, `if-layers` and `then-layer` are layer numbers. A `#define NAME n` counts when every use of `NAME` is a layer position, and the define is the number that gets rewritten; when ZMK writes a layer key it uses that name, so the define and the keys keep reading the same.

Anything else that touches a layer number stays a refusal: arithmetic on one, a layer bitmask (`layer_state_set(1UL << 3)`), `get_highest_layer(…) > 2`, `ledmap` rows without designators, a layer named by an identifier no `#define` resolves, a define also used as a plain number, and an unknown QMK function passed a name the importer resolved as a layer. Each is a line in `unprovable`, and the rule quotes it. Deleting a layer the code names is refused, naming the key or line, as before.

## Reachability

`src/validation/reachability.ts` builds a graph. Each node is a layer. Each edge is a way to get there: a momentary, toggle, `to` or one-shot binding, a hold-tap whose hold is a layer, or a combo whose output is one of those. Edges start from the layers that contain them. A conditional layer (D-385) adds its third layer once both of its first two are reached. A layer is reachable if the graph reaches it from the base layer.

The reachable functions are the functions ([02](02-layout-model.md#functions-and-reachability)) of every binding on a reachable layer, plus the tap and hold halves of hold-taps, plus combo outputs. A `transparent` slot contributes the binding underneath it on the layer it falls through to.

`function_lost` compares the before and after sets. `diff.displaced` pairs each changed slot's old function with the slot where it now lives, if any. `relearnCount` counts functions present in both sets whose slot changed.

## Warnings

Warnings appear in the preview beside the trade-offs. They don't block apply.

| Code | Rule | Why |
|---|---|---|
| `doubled_letter_tapdance` | A modelled tap dance, or a native Oryx one, whose tap is a letter that doubles in common English words (`l s e o t f p r m c n d g b z`) | "class" would break. This is why double-tap S was rejected for Option–Option (D-019) |
| `homerow_same_hand_mods` | A home-row letter holds a modifier without opposite-hand protection: QMK `CHORDAL_HOLD`, ZMK trigger positions excluding its own hand apart from thumbs, or a kanata opposite-hand variant. One warning per profile, only for a hazard the change adds (D-058) | Rolling same-hand letters can trigger the modifier by accident (D-017) |
| `conditional_layer_unsupported` | A conditional layer in a kanata layout | kanata has one active layer at a time, so "A and B held" can't be written; the condition stays in the layout and is left out of the config (D-388) |
| `moved_pinned` | The change moves a slot or function covered by a `pinned` priority | BK said to keep it there (D-021). It's a reminder, not a block (D-023) |
| `contradicts_decision` | The change alters, retunes or removes the layer of keys an active `choice` decision placed, unless BK marked it `tried_unhelpful`. The `DecisionReminder` carries the stored goal, choice, reason and status | It surfaces the old reason (D-022, D-053) |
| `outside_selection` | The message carried a selection, and the change edits a key that isn't in it (another position, or the same position on another layer) | BK pointed at the keys he meant. Editing others is sometimes necessary, but he should see it (D-062) |
| `large_relearn` | `relearnCount` is above 6 | Muscle memory cost. BK should choose it knowingly |
| `identifier_clash` | ZMK macros, non-built-in profiles and tap dances (including generated hold helpers) cannot share a generated label or shadow a built-in behaviour. Combo display names cannot generate the same node name. Built-in `mt`/`lt` profile overrides are allowed | A warning when newly introduced; standing board review also reports it. Layers have separate node names; QMK uses generated counters, so neither produces this warning. See `src/validation/identifier-rules.ts` |
| `tap_dance_same_action` | Two filled slots of a tap dance do the same thing (tap and double-tap are both Esc). Reported for the first key that uses it, and only when the change adds or alters it (D-156) | The extra slot adds nothing, and the key waits for a second tap for no reason |
| `macro_looks_like_secret` | A macro's `text` step matches keyloom's secret-like-text heuristic | Firmware isn't a safe place for a secret: anyone with the keyboard can replay it. This does not scan arbitrary key-step sequences |

`moved_pinned` and `contradicts_decision` are warnings on purpose. An old decision prompts a reminder; it never prevents a new one (D-023).

## Tests

The validator is where keyloom's correctness lives, so it gets the heaviest testing:

- Table tests for every error and warning code, against small synthetic boards.
- Property tests (`fast-check`). For random valid layouts and random op lists, either `validate` fails or the applied document parses, every layer is reachable, and no function is lost without a `dropFunction` op.
- Fixtures from BK's real Moonlander and Glove80 imports, with the Option–Option and Command–Shift proposals as golden cases (D-025).
