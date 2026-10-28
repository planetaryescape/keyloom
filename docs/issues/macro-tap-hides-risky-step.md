# A bootloader step inside a macro tap gets no risky-key warning

Status: fixed on branch fix/five-zmk (the reader treats `&macro_tap`, `&macro_press`, `&macro_release` and `&macro_pause_for_release` as modes and reads the steps after them).

Found by stage T's independent review (round 5), 2026-10-23, at `02e8c4f`.

D-451 warns when a new or moved key would put the keyboard into its bootloader, restart it or forget Bluetooth pairings. The reader stops at ZMK macro controls such as `&macro_tap`, so a step behind one isn't seen. The repro is a kept zero-argument macro with `bindings = <&macro_tap &bootloader>;` used as the tap of a kept hold-tap (`bindings = <&mo>, <&reset_macro>;`). Adding `&magic 1 0` with correct layer refs validates with no warning, and the key is generated. ZMK runs `&macro_tap` as tap mode (moergo-sc/zmk `app/src/behaviors/behavior_macro.c` L69-L102 @ ce69e85), so the key does enter the bootloader.

It needs an imported macro written this way. The warning is advisory and never blocks a change. The fix is to read macro control steps (`&macro_tap`, `&macro_press`, `&macro_release`, `&macro_pause_for_release`) as modes and keep reading the behaviours after them. An unresolved tap shouldn't simply be refused, because the MoErgo `&magic` key's tap is a macro the reader doesn't model.
