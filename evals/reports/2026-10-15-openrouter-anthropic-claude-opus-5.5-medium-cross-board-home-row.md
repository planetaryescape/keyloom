# cross-board-home-row eval, 2026-10-15, openrouter, anthropic/claude-opus-5.5 (effort medium)

Cost: $0.342.

## Home row mods, Glove80
- pass: lookedAtTheMoonlanderItself
- pass: usedMapKeys
- pass: proposedSomethingValid
- pass: didNotAskForOryxOrScreenshots
- pass: onlyHomeRowKeysChange
- pass: everyModCarriedWithTheRightModifiers
- pass: profilesWaitForTheOtherHand

Moonlander home-row mods (letter: modifiers): [["S",["ALT"]],["F",["GUI"]],["G",["ALT","CTL","GUI","SFT"]],["H",["ALT","CTL","GUI","SFT"]],["J",["GUI"]],["L",["ALT"]]].
Tool calls: list_layouts, get_layout(my-moonlander), get_layout, map_keys, propose_changes.
Turns: 1. Model requests: 4. Reported cost: $0.342.

### Agent replies
Turn 1: I've proposed copying your six home row mods from the Moonlander to the same letters on the Glove80's default_layer. Nothing has changed yet: you still need to apply it, then build and flash.

**What changes**
- **Left hand:** key 37 is S/⌥ (Option), key 39 is F/⌘ (Command), key 40 is G/Hyper.
- **Right hand:** key 41 is H/Hyper, key 42 is J/⌘, key 44 is L/⌥.
- Each key still types its own letter, so nothing else moves.

**How it will feel**
- Your Moonlander uses two QMK settings, Chordal Hold and Permissive Hold, that ZMK doesn't have. Instead, these keys only act as a modifier when the next key you press is on the other hand or a thumb key. They also never turn into a modifier if you pressed another key less than 150 ms before, so fast typing stays as letters.
- The timings (280 ms to count as a hold) are a starting guess, not taken from your Moonlander. After you've typed on it for a while, tell me if a modifier feels slow to kick in or fires by accident, and I'll adjust it.

**Left out**
- Z/⌃ and //⌃ on the Moonlander's bottom row. They aren't home row keys, so I didn't include them. Say if you want them too.
- Your other layers and their colours. This board can't give single keys their own colour: its lights show one effect across the whole board.

**Already there before this change:** if you switch to factory_test_layer from key 80 on magic_layer, there's no key to get back to default_layer.

### Proposals
#### Moonlander home row mods on S, F, G, H, J, L (valid)
Each home row mod on the Moonlander's Layer 0 goes to the Glove80 key that types the same letter on default_layer: S holds Option, F holds Command, G holds Hyper on the left; H holds Hyper, J holds Command, L holds Option on the right. The Moonlander uses QMK Chordal Hold and Permissive Hold. ZMK has neither, so the closest match is a balanced hold-tap that only turns into a modifier when the next key is on the other hand or a thumb, plus a 150 ms idle rule so fast typing stays as letters.

Ops: [{"op":"upsertHoldTapProfile","profile":{"id":"home-row-mods-left","name":"Home-row mods (left hand)","firmware":"zmk","options":{"bindings":"&kp &kp","flavor":"balanced","tapping-term-ms":280,"quick-tap-ms":175,"require-prior-idle-ms":150,"hold-trigger-key-positions":[5,6,7,8,9,16,17,18,19,20,21,28,29,30,31,32,33,40,41,42,43,44,45,52,53,54,55,56,57,58,59,60,61,62,63,69,70,71,72,73,74,75,76,77,78,79]}}},{"op":"upsertHoldTapProfile","profile":{"id":"home-row-mods-right","name":"Home-row mods (right hand)","firmware":"zmk","options":{"bindings":"&kp &kp","flavor":"balanced","tapping-term-ms":280,"quick-tap-ms":175,"require-prior-idle-ms":150,"hold-trigger-key-positions":[0,1,2,3,4,10,11,12,13,14,15,22,23,24,25,26,27,34,35,36,37,38,39,46,47,48,49,50,51,52,53,54,55,56,57,64,65,66,67,68,69,70,71,72,73,74]}}},{"op":"setBinding","at":{"layerId":"default-layer","position":36},"binding":{"kind":"holdTap","tap":{"code":"S"},"hold":{"mods":["LALT"]},"profileId":"home-row-mods-left"}},{"op":"setBinding","at":{"layerId":"default-layer","position":38},"binding":{"kind":"holdTap","tap":{"code":"F"},"hold":{"mods":["LGUI"]},"profileId":"home-row-mods-left"}},{"op":"setBinding","at":{"layerId":"default-layer","position":39},"binding":{"kind":"holdTap","tap":{"code":"G"},"hold":{"mods":["LCTL","LSFT","LALT","LGUI"]},"profileId":"home-row-mods-left"}},{"op":"setBinding","at":{"layerId":"default-layer","position":40},"binding":{"kind":"holdTap","tap":{"code":"H"},"hold":{"mods":["RCTL","RSFT","RALT","RGUI"]},"profileId":"home-row-mods-right"}},{"op":"setBinding","at":{"layerId":"default-layer","position":41},"binding":{"kind":"holdTap","tap":{"code":"J"},"hold":{"mods":["RGUI"]},"profileId":"home-row-mods-right"}},{"op":"setBinding","at":{"layerId":"default-layer","position":43},"binding":{"kind":"holdTap","tap":{"code":"L"},"hold":{"mods":["RALT"]},"profileId":"home-row-mods-right"}}]

Warnings: layer_trap
