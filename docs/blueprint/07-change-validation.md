# 07: Change validation

Every change set passes through one validator before BK sees it, and again before it's applied (D-014). The agent's output is a proposal, not a fact. Without the validator, the first sign of a broken layer would be a keyboard BK can't type on. The validator is a pure function in `src/validation/`:

```ts
validate(board: BoardDefinition, before: Layout, ops: ChangeOp[]): ValidationResult

type ValidationResult = {
  ok: boolean;                         // false if any error
  errors: Issue[];                     // block preview and apply
  warnings: Issue[];                   // shown; don't block
  diff: {
    changed: Slot[];                   // every slot whose binding changed
    displaced: { function: string; from: Slot; to: Slot | null }[];
    dropped: { function: string; reason: string }[];
    relearnCount: number;              // functions that moved position
    reminders: DecisionReminder[];     // 08
  };
};
type Issue = { code: string; message: string; slots?: Slot[] };
```

Both the agent (`analyse_change`, `propose_changes`) and the editor call it. The CLI exposes it as `keyloom change check`.

## Errors

Errors make the change set invalid. The codes are stable strings that the agent sees, so it can fix the proposal.

| Code | Rule | Why |
|---|---|---|
| `schema` | Ops and resulting document parse with the zod schemas | Nothing malformed reaches firmware generation |
| `stale_base` | Ops touch a slot that changed since the change set's base revision | The proposal was made against a layout that no longer exists ([02](02-layout-model.md#applying-undoing-and-stale-bases)) |
| `binding_count` | Every layer has exactly `board.keys.length` bindings | Generated firmware would not compile |
| `unknown_ref` | Every `layerId`, `macroId`, `profileId` and combo position exists | Dangling references |
| `function_lost` | Every function reachable before is reachable after, unless a `dropFunction` op names it | Principle 5: nothing gets lost silently (D-020) |
| `layer_unreachable` | Every layer can be reached from the base layer through layer actions, layer-taps or combos | A layer nobody can reach is a lost function |
| `layer_trap` | A layer entered with `toggle` or `to` has a binding that leads back | Otherwise the keyboard gets stuck on it |
| `firmware_unsupported` | Every binding kind and option exists in the board's firmware ([05](05-firmware-qmk.md), [06](06-firmware-zmk.md)) | D-024. The firmware decides what's expressible |
| `qmk_modtap_basic` | On QMK, a hold-tap's tap side is a basic keycode with no mods | QMK limits `MT()` to basic keycodes (qmk/qmk_firmware `7a1bbf3` `docs/mod_tap.md:65`) |
| `qmk_modtap_mixed_hands` | On QMK, a mod-tap's mods are all left-hand or all right-hand | One right-hand mod makes all of them right-handed (same source) |
| `combo_conflict` | Two combos on the same layers don't use the same set of positions | Only one could fire |
| `passthrough_layer_index` | No op removes or reorders layers when the layout has `Passthrough` that refers to layer indices. Adding a layer at the end is allowed | Oryx's RGB and custom-key code uses layer numbers and would silently point at the wrong layers (S3) |
| `layer_limit` | The layer count stays within the firmware's limit, including `LAYER_STATE_8BIT` (8) where it's set | The firmware wouldn't compile, or layers above the cap would be unreachable (S3) |
| `native_edit` | No op changes a `native` binding or a `Passthrough` block, except to replace it whole after BK confirms | keyloom can't reason about source it doesn't model (D-024) |

## Reachability

`src/validation/reachability.ts` builds a graph. Each node is a layer. Each edge is a way to get there: a momentary, toggle, `to` or one-shot binding, a hold-tap whose hold is a layer, or a combo whose output is one of those. Edges start from the layers that contain them. A layer is reachable if the graph reaches it from the base layer.

The reachable functions are the functions ([02](02-layout-model.md#functions-and-reachability)) of every binding on a reachable layer, plus the tap and hold halves of hold-taps, plus combo outputs. A `transparent` slot contributes the binding underneath it on the layer it falls through to.

`function_lost` compares the before and after sets. `diff.displaced` pairs each changed slot's old function with the slot where it now lives, if any. `relearnCount` counts functions present in both sets whose slot changed.

## Warnings

Warnings appear in the preview beside the trade-offs. They don't block apply.

| Code | Rule | Why |
|---|---|---|
| `doubled_letter_tapdance` | A multi-tap behaviour on a letter that doubles in common English words (`l s e o t f p r m c n d g b z`) | "class" would break. This is why double-tap S was rejected for Option–Option (D-019) |
| `homerow_same_hand_mods` | A hold-tap on a home-row letter has no opposite-hand constraint (QMK Chordal Hold or ZMK `hold-trigger-key-positions`) | Rolling same-hand letters triggers the modifier by accident (D-017) |
| `moved_pinned` | The change moves a slot or function covered by a `pinned` priority | BK said to keep it there (D-021). It's a reminder, not a block (D-023) |
| `contradicts_decision` | The change undoes or moves something an active decision placed deliberately | It surfaces the old reason (D-022) |
| `large_relearn` | `relearnCount` is above 6 | Muscle memory cost. BK should choose it knowingly |
| `identifier_clash` | A layer, macro, combo or profile ID would generate a name that collides with a firmware identifier (a ZMK behaviour label, a QMK keycode) | Generated firmware would fail to compile or bind the wrong thing. Taken from keymap-editor's warnings ([../research/keymap-editor.md](../research/keymap-editor.md)) |
| `macro_looks_like_secret` | A macro types a long run of plain characters with no modifiers, which looks like a password | Firmware isn't a safe place for a secret: anyone with the keyboard can replay it. Taken from keymap-editor's warnings |

`moved_pinned` and `contradicts_decision` are warnings on purpose. An old decision prompts a reminder; it never prevents a new one (D-023).

## Tests

The validator is where keyloom's correctness lives, so it gets the heaviest testing:

- Table tests for every error and warning code, against small synthetic boards.
- Property tests (`fast-check`). For random valid layouts and random op lists, either `validate` fails or the applied document parses, every layer is reachable, and no function is lost without a `dropFunction` op.
- Fixtures from BK's real Moonlander and Glove80 imports, with the Option–Option and Command–Shift proposals as golden cases (D-025).
