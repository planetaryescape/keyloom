# Long firmware names stay inside the key card

The design review on 13 November 2026 reproduced a label overflow on `origin/main` at `8d09a1f5`. In Advanced view, Moonlander key 22 drew `RCTL(KC_B)` at 135.61px inside a 95.20px face. The label reached the modifier controls.

The fix is `c19b2bf4`. The card now uses `fitLegend`, condensed text and break opportunities in firmware names. Filled corners reserve their own row. They use compact gesture marks instead of long labels. Tooltips and accessible names retain the actions. The tap-then-hold tooltip now names its action rather than printing a generic filled marker. D-600 records the layout. D-601 applies the existing neutral confirmation style to flash approval.

## Reproduce the editor checks without a keyboard

```sh
bun scripts/dev-editor.ts 4710
```

Open the printed URL and choose Moonlander. This server uses a fake backend and the published synchronized Oryx fixture. It cannot flash a keyboard.

1. Open More, then Advanced view.
2. Select key 22 on the first layer.
3. Check that the full firmware name stays inside the key face.
4. Open its tap picker and repeat at the compact preview size.
5. Check a tap-dance key with both extra actions set. Each corner must stay clear of the tap label.

The fake backend does not implement every tap-dance operation. For the two-corner check, the review used a real server on an isolated scratch database, with system actions refused. The review sent no change to hardware.

Repeat at 1440×900 and 390×844 in both themes. Wait for page transitions before measuring text or running accessibility checks. The app builds its web assets once per server process, so restart the server after source changes.

## The recorded checks have different scopes

All 72 Moonlander key cards passed browser text-bound checks in Advanced view after the fit changes. The final 84px preview with both extra actions set passed text-bound and axe WCAG checks at both viewport sizes in both themes. The one-shot editor from `054d4169` passed the four screenshot modes. Its switch toggled off and back on.

The broader sweep checked Home, the board, board/config pickers, chat, History, Library, menus, Settings, the empty typing lab and Combos. It did not exercise hardware, a paid model or real operating-system setup.

The local suite before the final corner-label change recorded 4,932 passes, 244 skips and five failures outside the web renderer. An isolated run across the four named failing files recorded 85 passes, one skip and one failure. The remaining failure asserted a waiting instruction in `test/app/firmware-zmk.test.ts:171`. The flash itself succeeded. Four focused cases passed on the unchanged review base. These observations do not establish a cause for the timing differences.

The UI, editor and layout check after rebasing onto `054d4169` passed 1,574 tests across 176 files. Final focused checks and CI cover the later corner-label change. Release and installation evidence belongs in the design-review handover, not in these source checks.
