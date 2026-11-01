# Activity tests in onboarding and review

Source-candidate UI checks for D-473, using synthetic scratch configs. The review result came from real QMK replay with a scripted provider, not a paid model. The Glove80 setup frame was synthetic; no device was read or flashed.

## Screens

| Surface | Dark, 1440×900 | Light, 1440×900 | Dark, 390×844 | Light, 390×844 |
|---|---|---|---|---|
| Import, Writing selected | [Desktop](import-dark-desktop.png) | [Desktop](import-light-desktop.png) | [Phone](import-dark-phone.png) | [Phone](import-light-phone.png) |
| New-board copy | [Desktop](put-dark-desktop.png) | [Desktop](put-light-desktop.png) | [Phone](put-dark-phone.png) | [Phone](put-light-phone.png) |
| Review and verified costs | [Desktop](review-dark-desktop.png) | [Desktop](review-light-desktop.png) | [Phone, results scrolled into view](review-results-dark-phone.png) | [Phone, results scrolled into view](review-results-light-phone.png) |

The copy screen's phone body scrolls independently of its fixed Make/Later footer. The selected activity and explanatory text are in that scroll area. The review uses its existing phone sheet and keeps Apply reachable at the bottom of the suggestion. No horizontal page overflow was observed at either width.

## Walked paths

- Chose Writing with keyboard focus and Space. Checkboxes have native labels; disclosures open with Enter and retain visible focus.
- Opened a known, unconfigured synthetic Glove80, chose a Moonlander config, selected Writing and pressed Make. The returned config retained `workloadActivities: ["prose"]`; its mapping remained a proposal, not applied.
- Chose Writing on the import screen, uploaded the existing public Oryx fixture as a zip, and landed in the new config's review with Writing selected. The harness deliberately did not start automatic review; its pending first review was not reported as a missing activity choice.
- Read baseline coverage, opened current-to-suggested results, switched themes and resized. The verified writing result showed 22 → 21 presses and peak 2 → 1 keys.
- After PR review fixes, Make on a known-board copy opened that config's review. Switching away and selecting it again kept the review closed. Selecting Writing on import also added `--activities prose` to every card's terminal command.

## Design review

The new controls reuse Instrument Sans, existing ink/surface tokens and native inputs/disclosures. There is no new score, chart, decorative color or second sidebar. Activity choices remain explicit; selected profiles fold away so the board and suggestions keep their existing hierarchy. Docker downloads, wait time, test limits and the absence of device writes are disclosed next to the choices. Keyboard and responsive checks found no new blocking issue.

A scoped axe 4.12.1 check of Activity tests reported nine passes, zero violations and zero incomplete checks. The browser console contained only the React development-tools notice, with no runtime error. This scoped check is not a whole-app WCAG conformance claim.

The fake setup stream remains static after Make, unlike the real sync engine. Its later repeated setup offer is not evidence of product behavior. Live models, real USB setup and flashing were not tested by this harness.
