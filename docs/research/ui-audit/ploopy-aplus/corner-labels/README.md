# Small physical caps keep readable labels and working slot controls

The second review of PR 353 found a corner-label overlap at `d801fad4`. The card now preserves its physical shape and the legend font floor. If all action regions cannot fit, named extra slot controls appear below the cap. Roomy caps retain their corner labels on the cap.

Computer Use through the Codex CLI checked the existing `test/web/hero-cap-fit.fixture.html` fixture in Dia. It uses the real HeroCap component and loaded fonts, with synthetic bindings and no backend. Both themes displayed:

```text
PASS: nine rendered cases, corner bands, external slots, full names, font floor and label changes
```

| Case | Result |
| --- | --- |
| 6: wide flat cap at 112 px | The A label stays on the cap. Readable hold and corner controls sit below it. |
| 7: actual A+ outer shape at 84 px | The compact physical outline stays intact. The extra controls sit below it. |
| 8: actual A+ outer shape at 112 px | Tap, hold and corner labels fit inside their regions. |

The fixture measures tap and corner text against their regions and checks the legend floor. It also checks that external controls clear the cap. Computer Use checked these click results:

```text
Opened hold in case 6
Opened doubleTap in case 6
Opened tapThenHold in case 7
```

[Dark capture](dark.png) and [light capture](light.png) display all nine cases. The source screenshot measured 6380 × 2614 pixels. The observed page crop was x=850, y=220, width=5520, height=920. The crops omit browser chrome and unrelated pages.

The CLI restored dark mode, closed its fixture tab and reset node_repl. The fixture server stopped after verification. This check covers the component fixture, not a new full-editor or phone viewport run. The [full editor evidence](../review-followup/README.md) records the earlier native-button and knob checks.

Local receipts, accessibility text and click screenshots remain in `/tmp/keyloom-aplus-corner-cua`. The checked theme captures above are the durable evidence.
