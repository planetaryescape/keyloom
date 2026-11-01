# Verify long replies without losing the keyboard

Run the synthetic server in one terminal:

```sh
bun test/web/chat-scroll-server.ts
```

In another terminal, run the browser regression and regenerate these screenshots:

```sh
bun test/web/chat-scroll.browser.ts docs/research/ui-audit/chat-scroll
```

The fixture streams a 30-paragraph reply and three proposals through the real App/Viewer. Each viewport/theme clears its saved thread before navigation and asserts that exactly one assistant reply is present. It uses no credentials, database or physical keyboard. It never applies a proposal.

## Reproduction and repair

Before the fix, the regression failed at 1440×900: the document was 1,954 px tall. Scrolling the page to its end moved the keyboard's bottom to −364 px, completely out of view.

The screen-reader-only proposal summary was absolutely positioned relative to `.chat`, outside the conversation's scroll container. Its static position after the reply extended the document even though the visible reply already scrolled internally. Making `.chat-log` a positioning container keeps that text inside the scroller, without removing it from the accessibility tree or clipping the outer panel's menus.

This restores the existing board-beside-conversation design in D-310/D-318; it does not change that design.

## Checks

- Browser regression passed twice after the fix at 1440×900, 1100×577 and 390×844 in light and dark themes. It checks page height, composer visibility, both ends of the conversation, and PageDown scrolling without moving the keyboard or page.
- Screenshots in this folder show the long reply after keyboard scrolling. Visual review against blueprint chapters 18 and 23 found the desktop keyboard and layer strip still visible; the phone keeps its existing half-height sheet and board above it.
- `bun test test/web test/server/chat-routes.test.ts`: 615 passed.
- `bun test test/server`: 134 passed.
- Before shipping, the browser regression, typecheck and dependency check passed again on `dac458eb` (v0.68.0) plus this repair; `bun test test/web test/server` passed 747 tests there.
- `bunx tsc --noEmit`, `git diff --check` and the scoped anti-slop check passed.
- `bun run depcruise` reported no violations, with its existing TypeScript 7 compatibility warning.
- Local full `bun test` did not finish within the initial 120-second timeout. A longer retry was stopped during CLI firmware tests. GitHub CI on `4313baf1` subsequently completed the full suite: 3,562 passed, 250 skipped and 0 failed across 387 files.

Evidence is from the source-served Chromium app, not a released desktop build. The installed CLI reports 0.66.0; its version check does not verify this UI repair. No hardware flash or real-data server was used.
