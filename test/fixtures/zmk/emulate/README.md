# Emulator run logs

Each `.log` is what the native_posix_64 firmware printed after the `KEYLOOM-EMULATE-RUN` marker in a real
`keyloom emulate` run (2026-10-15), as the emulator keeps it in its cache. They are the parser's input in
test/firmware/zmk/emulate-log.test.ts.

| File | Layout | Keys |
|---|---|---|
| `glove80-tap-letter.log` | Glove80 layout-editor-style (test/fixtures/zmk/layout-editor-style) | `tap 25` |
| `glove80-home-row-mod.log` | Glove80 layout-editor-style (test/fixtures/zmk/layout-editor-style) | `hold 39 300 then tap 30` |
| `glove80-layer-tap.log` | the same | `hold 79 100 then tap 25` |
| `corne-consumer.log` | Corne (test/fixtures/zmk/corne) | `tap 36` |
