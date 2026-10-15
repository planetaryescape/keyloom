# A ZMK macro's waitMs step does not pause for that long

`renderMacro` (`src/firmware/zmk/emit-behaviors.ts`) writes a `waitMs` step as `&macro_wait_time N`, and the importer reads it back the same way. In ZMK that binding sets the wait between the bindings that follow it; it is not a one-off pause. Copy, switch, paste with waits of 100 and 300 ms (QMK: `SS_DELAY`) gave 47 ms between the first two chords on the Glove80 and the Corne (`evidence/rung14/zmk-macros-glove80.json`), so Command-Tab is followed by the paste before a window has switched. The keys typed are right; the timing is not what the step says. QMK honours the delay (`qmk-macros.json`, gaps of 100 and 300 ms or more).

A fix writes the wait before the binding it should follow, restores the default after, and reads that shape back as a pause; it changes how Layout Editor macros import, so it wants its own change and a ZMK run.
