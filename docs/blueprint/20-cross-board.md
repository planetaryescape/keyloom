# 20: Copying from my other keyboard

Proposed extension, 2026-10-18: [30](30-agent-keyboard-context.md) adds explicit destination targeting, transfers visible in the originating conversation and multi-keyboard outcomes (D-401, D-402, D-405). It reuses the correspondence and capability rules here. The existing one-layout write scope below describes the baseline implementation, not the new target experience.

Status: built in rung 19, 2026-10-15. Source baseline: origin/main at `898dec6` (v0.19.0). Results: S21 in [15](15-open-questions.md). Native code is translated where its meaning is known (D-451, 2026-10-22).

BK, on seeing the agent fail: "I think the agent shoudl be able to see the layouts of other keyboards. and it should be possible for me to say copy this thing from my other keyboard and apply it here and it should have the smarts to figure out the best way to do it even if the keyboards have differnt number of keys or differnt layouts" (D-220).

What happened in his v0.19.0 chat on the Glove80: he asked it to copy the key lights to be like his Moonlander's. It answered that it couldn't see the Moonlander, asked for an Oryx link or screenshots, asked how to match layers and keys, and said "I can set per-key colours on each layer here". All of that was wrong. keyloom holds the Moonlander, and the Glove80 can't show per-key colours (D-225).

## The agent sees every layout, and edits one

Three changes to the tool surface (D-220):

- `list_layouts` returns every layout: id, name, board, firmware, layers, what the board can and cannot do, and which layers have LED colours.
- `get_layout` takes an optional `layout` (id or name) and returns that layout's grids and JSON, headed READ-ONLY, with a reminder that its positions belong to its own board.
- `map_keys` translates between two layouts (below) and can build the ops for a copy.

Proposals still target only the conversation's layout, and validation is unchanged (D-014). The system prompt lists the other layouts by name and board and tells the agent to look before it asks BK for anything keyloom holds.

A stored Oryx layout still keeps its colours and tap dances as code until BK clicks "Update layout" (D-193). The agent would see none of the Moonlander's colours. So another layout is shown the way a fresh import would read it, in memory, and nothing is saved (D-222).

## Board capabilities are facts

`src/boards/capabilities.ts` says what each board can do: per-key colours, combos, tap dance, macros and hold-taps. Everything but colours is the same on both firmwares. Colours exist only where `board.json` has `lighting.ledPositions`. A board without them carries `limits.lighting`, one sentence a person can read, such as the Glove80's "its lights are ZMK underglow, which shows one effect across all 80 LEDs, and MoErgo's firmware (v26.09) has no way to give a key its own colour on a layer" (D-224).

That sentence is what the agent says, what `list_layouts` and the prompt state, and what the validator's `lighting_unsupported` error now quotes when an op asks for colours on such a board. The prompt tells the agent never to offer what a board can't do, and not to call `propose_changes` for it. `map_keys` with `carry: "lighting"` on such a board returns the sentence and no ops.

## Which key is the same key

`map_keys` is deterministic code in `src/boards/correspondence.ts`, not model judgement (D-221). The model supplies intent (which layout, which layer, which keys, which strategy) and reads the result.

**Layers** (`src/layout/layer-match.ts`, D-223). Each source layer is scored against each target layer on three signals: name (equal after dropping case and punctuation scores 1, a shared stem such as Navigation and navigate 0.7, and a name with a number matches only exactly, so Layer 4 is not Layer 5), role (the base layer is the base layer), and function overlap (the Jaccard overlap of the functions the layers produce, leaving out layer switches, macros and native code, whose ids differ). The strongest signal sets the score. Layers pair one-to-one, best first, and a layer under 0.3 pairs with nothing and reports how close it came.

**Keys, by position** (`src/boards/key-slots.ts`). Every key gets a slot from geometry and `board.json`, never from the order of anything in them:

- hand and finger;
- row offset from the home row, with rows ordered by their mean height;
- column offset from the finger's home key, positive outward. The home key is the home-row key nearest the middle finger: the outermost index column and the innermost pinky column;
- for thumbs, a rank from the middle of the board at the bottom edge.

Two keys match by position when hand, finger and row offset agree, and by column when that agrees too. The boards differ in columns, so a key with no exact column takes the nearest unclaimed column of the same finger and row at lower confidence. A key with no key to take is reported, not forced onto a neighbour.

**Keys, by function.** Keys match on what they produce (`bindingFunctions`), with layer ids rewritten through the layer match and macros compared by their steps. First on all functions (S/Option on both sides), then on the first function alone (types S, the hold differs). Several candidates are paired by nearest slot; spare targets are offered, not assigned.

**Strategy.** `function`, `position`, or `auto`, which is function first and then position for what is left, on target keys nothing claimed.

**Confidence.** Function matches score 0.95 under the same finger, 0.85 elsewhere, 0.8 and 0.7 for the first-function match, with a 10% cut when several keys do the same thing. Position matches score 0.7 for an exact slot, 0.5 down to 0.3 for a nearer column, and 0.5 or 0.4 for thumbs. Two keys under one finger can do unrelated things, so a position match never reaches a function match (D-228). The default floor for carrying a match into ops is 0.6, so thumbs and nearest-column guesses are shown and not applied.

On the Moonlander, Glove80 and Corne, home rows map to home rows by finger in every direction, thumbs map to thumbs of the same hand, the Moonlander's number row has no place on the Corne and says so, and shuffling every list and record in `board.json` changes nothing (`test/boards/correspondence.test.ts`).

This needed a data fix. The Corne's `fingers` was one column off: its outer pinky column was marked as the pinky, so Q was a ring finger and A, S, D, F came out ring, middle, index, index. A test that asks the A S D F letters for their fingers on all three boards found it (D-227).

## Copying

`carry` on `map_keys` builds ops, checks them, and returns them with a line per key (D-226).

- **`lighting`:** one `setLayerLighting` per source layer that has colours and a matching target layer. Each coloured key's colour goes to the key it maps to; the layer colour carries over; target keys nothing maps to keep the layer colour; source keys with a colour and nowhere to go are listed. The op replaces the target layer's colours as a whole, and the output says so.
- **`behaviours`:** for source `positions` BK or the agent chose. A hold-tap keeps the target key's own letter and takes the source's hold; its modifiers become the hand of the key they land on (one right-hand modifier makes a QMK mod-tap right-handed); a layer key points at the matching layer or is skipped by name; macros and tap dances come along and are reused when the target already has the same steps. The profile is the target's own: the key's current one, else the one its finger uses, else its hand's. Where there is none, a ZMK profile is made per hand that waits for the other hand and the thumbs, with the source's tapping term when it has one. A QMK target reuses what it has. Native code is copied as described under native code below. A copy never replaces something else the target key does.
- **`combos`:** each combo's keys are mapped, the output binding is carried, layers are mapped, and the id is made unique.

QMK and ZMK hold most behaviours alike, so a copy across them is a copy. What doesn't carry is said in the output and the agent's reply: native code keyloom can't read (D-024), what a target board lacks, layers with no counterpart, keys with no counterpart, and any timing that was a guess.

### Native code

Native code is firmware source keyloom keeps as written (D-024). A copy reads what each native does (`src/layout/native-read.ts`): a one-shot modifier (QMK `OSM`, ZMK `&sk`, and a kept sticky key that passes its modifier to `&sk`), caps word, bootloader, reset, the RGB keys, Bluetooth and output selection, and a hold of a momentary layer (MoErgo's `&magic`). A ZMK behaviour or macro that keyloom kept is read through the layout's own kept definitions (`src/layout/kept-behaviours.ts`); a name defined twice reads as nothing. Each reading is written in the target's own spelling (`src/layout/native-write.ts`), or refused with the reason the target lacks it. A layer hold becomes the target layer's momentary binding, and the copy says its tap side is not carried.

Refusals name what is missing. A Bluetooth key on a board without Bluetooth says so. RGB keys need a board whose per-key lighting keyloom writes, so a Corne with underglow is refused. A ZMK sticky key holds one modifier. A key with two steps doesn't fit one binding. Anything keyloom can't read, such as a one-shot layer hold (`&layer_on_hold`) or a tap dance it kept as code, is skipped as it was before.

## What the agent asks

Only where the result is genuinely ambiguous: a match under 60%, several keys equally good, a layer with no counterpart, a key whose target already does something else. It states the mapping it used in plain words in its reply and in the proposal's explanation (D-229).

## Lighting on the Glove80

S21 read MoErgo's tree at `ce69e85`. Its underglow fills one buffer with one effect and overlays fixed-colour status LEDs; the layer indicator is a magenta LED on the left half only. No per-key, per-layer colour exists there. It exists in an open community pull request, `moergo-sc/zmk#36`, on a different base. So the Glove80 has no lighting in the model (D-194, D-225), and whether to build against that fork is Q24.

## Evals

`evals/scenarios/cross-board.eval.test.ts`, on OpenRouter with `anthropic/claude-opus-5.5`:

- colours onto the Glove80: explains why, proposes nothing, doesn't ask for an Oryx link or screenshots;
- colours onto a second Moonlander: a valid proposal that puts every colour on the same key, from a model that used `list_layouts`, `map_keys` and `get_layout`;
- home row mods onto the Glove80: a valid proposal on home-row keys only, each letter with the source's modifiers on the hand it sits on, in profiles that wait for the other hand. The model used `list_layouts`, `get_layout` of the Moonlander and `map_keys`.

Reports are in `evals/reports/`.
