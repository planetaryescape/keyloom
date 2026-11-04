# An unavailable view result does not prove the screen never rendered

Status: open, 2026-11-01. Found during the documentation closeout; no product-code change was made.

`src/agent/tools/open-view.ts` describes `unavailable` as "it did not open". That is stronger than the implementation can establish when a render acknowledgement is lost. The browser awaits `openView`, then sends `acknowledgeView` (`src/web/chat/useChat.ts`). The view can commit before that fetch fails or its signal expires. The server then settles the waiter as unavailable without a saved success (`src/app/open-view.ts`, `src/app/agent-runs.ts`).

The safe claim is "no confirmed open". The person may already see the destination; neither the model nor the client should infer success or automatically replay the action. Unsupported clients still have no navigation capability, and explicit pre-render guards still refuse the open.

Follow-up: align the tool description with this acknowledgement boundary. Add a regression that renders successfully but drops the acknowledgement, then checks the stored unavailable result and refusal of late success. `test/web/open-view-ack.test.ts` already proves fetch cancellation; `test/app/open-view.test.ts` proves timeout/late-ack settlement. Neither alone observes the rendered-but-unacknowledged browser case.

Checked at `a8b9fe998427fd54faf9782256dfc94fcc39ae00`; the same tool and acknowledgement paths shipped in v0.66.0. [Stage D evidence and waived GUI checks](../research/ui-audit/d-open-view/README.md) retain the verification limits. The [agent guide](../agent-views.md) uses the narrower wording.
