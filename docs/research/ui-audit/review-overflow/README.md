# Verify long review text stays inside the sidebar

Status: source repair verified on 2026-11-02. This page records source-served acceptance, not installed-release verification. The fixture uses the real App/Viewer sidebar with synthetic review data and the published Moonlander sample. It has no database, credentials, model calls, firmware work or physical keyboard access.

Start the synthetic server:

```sh
bun test/web/review-overflow-server.ts
```

In another terminal, run the regression and regenerate screenshots:

```sh
bun test/web/review-overflow.browser.ts docs/screenshots/review-overflow
```

The external `agent-browser` runner and its Chromium are prerequisites, not project dependencies; [installation commands](../chat-scroll/README.md) are shared with the chat-scroll regression. Restart the fixture server after changing production CSS so Bun rebuilds the served bundle.

## Reproduction and cause

Before the fix, the browser regression failed at 1440×900: the review panel began around x=958 and measured 1,260 px wide, ending around x=2,218. Its Close button was outside the viewport too. The assigned column was only about 478 px wide at that viewport. At 1280 px, removing the seven ordinary hints still left the same 1,260 px panel in a 423 px column; replacing only the long source paragraph with a short sentence restored the panel's column width.

`.br-panel` is a flex item inside the production sidebar column. Its default automatic minimum width retained the min-content width of an unspaced settings array. A shrinking grid track alone could not make that child fit. Setting only `min-width: 0` contained the panel but left its body horizontally overflowing (1,221 px of content in a 423 px body).

The fix adds `min-width: 0` and inherited `overflow-wrap: anywhere` to the review panel. The panel can shrink to its column, and long source-derived text can wrap without being removed, clipped or truncated. Review scheduling, proposal text, layout data and Apply remain unchanged.

## Checks and evidence

The regression passed twice after the fix at 1440×900, 1100×577 and 390×844 in light and dark. It checks panel/Close/footer bounds, body and document scroll widths, and every text node's line rectangles, so hiding overflow cannot masquerade as wrapping. It also scrolls the review to its bottom and checks that the keyboard does not move.

Read screenshots:

- 1440×900: [light](../../../screenshots/review-overflow/1440-900-light.png), [dark](../../../screenshots/review-overflow/1440-900-dark.png)
- 1100×577: [light](../../../screenshots/review-overflow/1100-577-light.png), [dark](../../../screenshots/review-overflow/1100-577-dark.png)
- 390×844: [light](../../../screenshots/review-overflow/390-844-light.png), [dark](../../../screenshots/review-overflow/390-844-dark.png)

The sidebar stays beside the keyboard on desktop; the existing phone sheet retains its Close button, footer and internal scrolling. No clipping or ellipsis was added to hide the source text. These captures use the full app's production column, not an isolated panel with a fixed-width wrapper.

Additional checks:

```sh
bun test test/web test/server/review-routes.test.ts
bunx tsc --noEmit
bun run depcruise
git diff --check
```

Observed: 629 tests passed, zero failures; type checking and changed-line anti-slop checks passed. Dependency rules reported no violations, with the existing TypeScript 7 compatibility warning. This is source-served Chromium evidence, not acceptance of a newly installed desktop build or a check of the user's private config.
