# cross-board-home-row eval, 2026-10-16, openrouter, anthropic/claude-opus-5.5 (effort medium)

Cost: $0.318.

## Home row mods, Glove80
- pass: namesKeysNotNumbers
- pass: lookedAtTheMoonlanderItself
- pass: usedMapKeys
- pass: proposedSomethingValid
- pass: didNotAskForOryxOrScreenshots
- pass: onlyHomeRowKeysChange
- pass: everyModCarriedWithTheRightModifiers
- pass: profilesWaitForTheOtherHand

Moonlander home-row mods (letter: modifiers): [["S",["ALT"]],["F",["GUI"]],["G",["ALT","CTL","GUI","SFT"]],["H",["ALT","CTL","GUI","SFT"]],["J",["GUI"]],["L",["ALT"]]].
Tool calls: list_layouts, get_layout, get_layout(my-moonlander), map_keys, propose_changes.
Turns: 1. Model requests: 5. Reported cost: $0.318.

### Agent replies
Turn 1: I've proposed copying the six home row mods from your Moonlander's base layer onto the Glove80's default layer. Nothing is applied yet: you apply it in the editor, then build and flash.

**What changes:** each key was matched by the letter it types:
- **Left hand:** S hold ⌥, F hold ⌘, G hold Hyper
- **Right hand:** H hold Hyper, J hold right ⌘, L hold right ⌥

The plain letters are just replaced, so nothing gets moved or lost.

**How the holds behave:** your Moonlander uses QMK's Chordal Hold and Permissive Hold. ZMK doesn't have those, so each hand gets its own hold setting that comes close. A home row key only acts as a modifier when the next key is on the other hand or a thumb key. Fast rolls on the same hand stay letters.

**What it costs:** those six letters now wait a moment before they act as a modifier. The timings are a starting guess, since ZMK feels a little different from QMK. After using it for a while, tell me if a modifier feels slow or fires by accident while you type.

**Not copied:** your Moonlander also has Z hold ⌃ and / hold right ⌃ on the bottom row. Those aren't home row keys, so I left them out. Want them too?

**Separate issue:** the factory test layer has no key back to the default layer, so you could get stuck on it. This change didn't cause it.

### Proposals
#### Moonlander home row mods on the Glove80 (valid)
Each Moonlander home row mod went to the Glove80 key that types the same letter: S hold ⌥, F hold ⌘, G hold Hyper on the left; H hold Hyper, J hold ⌘, L hold ⌥ on the right. Right-hand keys hold right-hand modifiers. The Moonlander's Chordal Hold + Permissive Hold (QMK) becomes the ZMK equivalent: a balanced hold-tap per hand that only turns into a modifier when the next key is on the other hand (or a thumb).

Ops: [{"op":"upsertHoldTapProfile","profile":{"id":"home-row-mods-left","name":"Home-row mods (left hand)","firmware":"zmk","options":{"bindings":"&kp &kp","flavor":"balanced","tapping-term-ms":280,"quick-tap-ms":175,"require-prior-idle-ms":150,"hold-trigger-key-positions":[5,6,7,8,9,16,17,18,19,20,21,28,29,30,31,32,33,40,41,42,43,44,45,52,53,54,55,56,57,58,59,60,61,62,63,69,70,71,72,73,74,75,76,77,78,79]}}},{"op":"upsertHoldTapProfile","profile":{"id":"home-row-mods-right","name":"Home-row mods (right hand)","firmware":"zmk","options":{"bindings":"&kp &kp","flavor":"balanced","tapping-term-ms":280,"quick-tap-ms":175,"require-prior-idle-ms":150,"hold-trigger-key-positions":[0,1,2,3,4,10,11,12,13,14,15,22,23,24,25,26,27,34,35,36,37,38,39,46,47,48,49,50,51,52,53,54,55,56,57,64,65,66,67,68,69,70,71,72,73,74]}}},{"op":"setBinding","at":{"layerId":"default-layer","position":36},"binding":{"kind":"holdTap","tap":{"code":"S"},"hold":{"mods":["LALT"]},"profileId":"home-row-mods-left"}},{"op":"setBinding","at":{"layerId":"default-layer","position":38},"binding":{"kind":"holdTap","tap":{"code":"F"},"hold":{"mods":["LGUI"]},"profileId":"home-row-mods-left"}},{"op":"setBinding","at":{"layerId":"default-layer","position":39},"binding":{"kind":"holdTap","tap":{"code":"G"},"hold":{"mods":["LCTL","LSFT","LALT","LGUI"]},"profileId":"home-row-mods-left"}},{"op":"setBinding","at":{"layerId":"default-layer","position":40},"binding":{"kind":"holdTap","tap":{"code":"H"},"hold":{"mods":["RCTL","RSFT","RALT","RGUI"]},"profileId":"home-row-mods-right"}},{"op":"setBinding","at":{"layerId":"default-layer","position":41},"binding":{"kind":"holdTap","tap":{"code":"J"},"hold":{"mods":["RGUI"]},"profileId":"home-row-mods-right"}},{"op":"setBinding","at":{"layerId":"default-layer","position":43},"binding":{"kind":"holdTap","tap":{"code":"L"},"hold":{"mods":["RALT"]},"profileId":"home-row-mods-right"}}]

Warnings: layer_trap
