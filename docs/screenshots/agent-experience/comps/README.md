# Proposed agent moments

**Synthetic, design-only. Not approved implementation, a live provider run, or a runtime contract.**

Open `index.html` directly in a browser. It is self-contained: the font, board markup, CSS and interactions are embedded; no server or network is needed. The Moment selector offers running, needs-answer, completed/folded, failed/partial-effects and stopped states. Light/dark switches preserve the selected moment.

## Scope and design choices

- **Operate; extend the existing world.** Preserve chapter 23's keyboard under the light, current tokens, Instrument Sans, Moonlander case, red thumb keys, amber preview marks and quiet side column. No new PRODUCT.md or DESIGN.md authority was created. The brief and chapters 28–30 settled the scope; no concept tournament or second-opinion review was run.
- **Hierarchy:** a trailing, inset user request with its sent-time board/config/layer/keys; a plain leading `keyloom` label and readable answer; compact operation rows below that hierarchy. Completion folds ordinary activity into a native disclosure. The proposal is a separate sibling, never inside the folded working region.
- **State is not device proof:** read/check/save labels are neutral. Prepared proposals are not applied revisions. Both the result and failure name what remains, what did not happen and the lack of device verification. The synthetic scenario assumes sync paused; production copy must use the real target's sync policy, including auto-sync consequences before Apply.
- **Motion:** only the short active status shimmers, at 1.8 seconds. Waiting, failure and stopped states do not shimmer. The pause control and `prefers-reduced-motion` both yield static readable text. Timings and operation summaries are illustrative constants, not fake live progress.
- **Phone:** the existing full-width sheet pattern, a right-half board view for K and L, and Show keyboard/Return to chat. The question scrolls into view without moving focus. The same content remains available at both widths. Native radios, buttons and disclosures provide keyboard operation; all question choices and submission controls have at least 44px targets.

## What works in the prototype

Moment/theme switches; working disclosure and nested operation summaries; radio preference and submit; Stop → stopped state; explicit synthetic recheck/restart; preview toggle; phone sheet lowering/return; desktop close/reopen without changing the selected moment; pause shimmer. Apply only explains that the prototype did nothing. Composer submission does not call a model.

The board is an inert snapshot, not a replacement keyboard implementation. Its proposed holds are described in accessible text outside the snapshot. Direct key selection, real validation, persistence, event replay, cancellation and device writes are intentionally absent.

## Evidence and provenance

- Branch: `design/agent-experience`.
- HEAD and fetched base: `c5efcb583c69df8841d154990fd3e63e92f9207b`.
- Committed base tree: `ff249fe5e51dce5887621267e36ead15bcb56f7a`.
- Incumbent visual references: `docs/screenshots/ask-keyloom.png`, `board-dark.png` and `conditional-layers/strip-1440x900-8-layers-side-light.png`; checked against current `src/web/tokens.css`, keyboard renderer, `ProposalCard.tsx`, `QuestionCard.tsx`, D-318 and D-319.
- Board markup: current app renderer at the base SHA, captured with `capture-editor.ts`: shipped `boards/zsa/moonlander` geometry/display plus the synthetic `test/fixtures/web/moonlander-sample.json` layout, in an in-memory `FakeEditor`. This avoids the fixture's simplified case. Synthetic legends are not BK's personal layout.
- `index.html` embeds unchanged incumbent token/keyboard/colourway styles; the extra styles and markup are proposed comps only.
- Font: Instrument Sans Latin variable WOFF2, sourced from `https://fonts.gstatic.com/s/instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1ZuWi3g.woff2`; SIL OFL in `OFL.txt`, obtained from `google/fonts`' `ofl/instrumentsans/OFL.txt`.
- SVG UI glyphs use a consistent 24px outline vocabulary matching the incumbent lucide shapes. No sparkle, wand, accent stripe, glow substitute or raw JSON transcript is rendered.
- Screenshots are browser captures of this synthetic HTML, not image-generated artwork. `renderer-snapshot.json` is the capture input; `proposal.template.html` and `build.ts` regenerate the standalone HTML with `bun docs/screenshots/agent-experience/comps/build.ts docs/screenshots/agent-experience/comps/renderer-snapshot.json`.

## Screenshots

Each of `running`, `waiting`, `completed`, `failure`, `stopped` has all four files:

`<moment>-1440x900-light.png`, `<moment>-1440x900-dark.png`, `<moment>-390x844-light.png`, `<moment>-390x844-dark.png`.

`desktop-states.png` and `phone-states.png` are contact sheets. Their ordering is moment first, alternating light/dark. `preview-board-390x844-light.png` and `preview-board-390x844-dark.png` show the lowered sheet and proposed holds. Screenshots use the same request/content, not shortened phone copy.

## Checks, bounded inspection and gaps

Two visual passes, then stopped. The final screenshot matrix and both phone board captures were opened and inspected. Browser assertions in `checks.json` confirmed disclosure reopening, question submission, Stop, honest nonfunctional Apply, and no document-level horizontal overflow at 390px. Reduced-motion emulation confirmed a static status. The final browser a11y result in `a11y.json` found zero violations, with one incomplete contrast rule covering six stage labels over the inherited room gradient.

The mechanical detector ran once on the template. It flagged the brief-required status-text shimmer as gradient text and small helper text; helper text was raised to 12px. The 0px match belongs to the phone's visually suppressed sync sentence, which remains in the accessible name. No design or code review agent ran. No production tests, paid model calls, real recordings, USB or firmware operations ran.

This is **not** a production accessibility certification. Browser contrast analysis cannot fully resolve inherited gradients or individual short key legends. It uses existing tokens, but no new token contrast test was added. Full keyboard journey, screen-reader announcements, provider events, focus-preserving automatic fold, long loops, old-conversation fallback, reconnect and actual safe cancellation remain implementation tests.

Phone running work can scroll; Stop is available below the operation rows rather than pinned. The completed proposal and failure's full effects/recovery are also scrollable. Review those trade-offs with BK. The first-rung comp does not cover cross-board transfers/key-picking, eight-layer narrow-laptop interaction, large transfer reports or resizable columns; those remain later design checks, not implied approvals.

## Approval needed from BK

Q30: approve or correct the request/answer hierarchy, restrained active shimmer, labeled operation rows, question priority, success folding with persistent proposal, failure/effect wording, and phone sheet behavior. Approving these comps does not approve later cross-board/mutating capabilities, protocol/storage schemas or a whole-app redesign.

## Knowledge packet for the integration owner

Keep operation labels separate from tool IDs. The final answer and proposal must not be descendants of the routine-work disclosure. Only fold successful routine work; retain unanswered questions, unsafe/unfinished jobs and failures. A read/check checkmark is not device-green. Keep each request/artifact's original target even if the next-request context changes. Closing the panel is not Stop, and reconnecting must not execute effects again. Derive timings, counts, tool summaries and effect receipts from actual execution in production; none of this page's constants are a contract.
