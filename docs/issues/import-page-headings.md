# Import pages lack a level-one heading

Status: Fixed in `7e1fc5a8ab2ae6b6991f782aa65b96093cba4e4e`.

At v0.80.6 source `b38c0d4a`, both import routes start with an `h2`. Neither route has an `h1`. Heading navigation cannot identify the page title at level one.

The failure affects “Bring in your first layout” from an empty setup and “Import a layout” from the config menu. Axe reports `page-has-heading-one` in light and dark at 1440×900 and 390×844.

The fix makes the page title an `h1` and each keyboard card title an `h2`. The CSS selectors follow those levels. Fonts, spacing, colors, controls, and import behavior stay the same.

Verification covers both routes in six viewport/theme modes: desktop, phone, and a 1280×577 short window. All 12 captures have one `h1`, a main landmark, correctly nested card headings, zero axe findings, and no horizontal overflow. Both back controls return to their prior screens.

Six desktop/phone before-and-after captures match pixel for pixel. The two phone first-import captures differ by at most one level in an RGB channel. The screenshot review found no layout change.

The existing 12 import guide/note tests pass with 42 assertions. TypeScript passes. No import, provider, device, signing, or release contract changes.
