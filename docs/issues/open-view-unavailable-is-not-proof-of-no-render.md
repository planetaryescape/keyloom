# An unavailable view result does not prove the screen never rendered

Status: fixed by the commit that adds `test/web/open-view-lost-ack.browser.ts` (2026-11-05). The tool description and system prompt now say an unavailable result is an unconfirmed open that may already be on screen, and tell the model not to retry on its own. Found 2026-11-01 during the documentation closeout.

`src/agent/tools/open-view.ts` describes `unavailable` as "it did not open". That is stronger than the implementation can establish when a render acknowledgement is lost. The browser awaits `openView`, then sends `acknowledgeView` (`src/web/chat/useChat.ts`). The view can commit before that fetch fails or its signal expires. The server then settles the waiter as unavailable without a saved success (`src/app/open-view.ts`, `src/app/agent-runs.ts`).

The safe claim is "no confirmed open". The person may already see the destination; neither the model nor the client should infer success or automatically replay the action. Unsupported clients still have no navigation capability, and explicit pre-render guards still refuse the open.

Follow-up: align the tool description with this acknowledgement boundary. Add a regression that renders successfully but drops the acknowledgement, then checks the stored unavailable result and refusal of late success. `test/web/open-view-ack.test.ts` already proves fetch cancellation; `test/app/open-view.test.ts` proves timeout/late-ack settlement. Neither alone observes the rendered-but-unacknowledged browser case.

Checked at `a8b9fe998427fd54faf9782256dfc94fcc39ae00`; the same tool and acknowledgement paths shipped in v0.66.0. [Stage D evidence and waived GUI checks](../research/ui-audit/d-open-view/README.md) retain the verification limits. The [agent guide](../agent-views.md) uses the narrower wording.

## Fix and evidence

`test/web/open-view-lost-ack.browser.ts` covers the rendered-but-unacknowledged case the two existing tests missed. It runs against `test/web/open-view-server.ts`, which now chooses the fake chat's ready provider; its earlier Anthropic choice reported as not set up, so the composer offered setup instead of sending. With every `view-ack` request aborted, sending "Open History" rendered the History panel and made exactly one acknowledgement attempt. The run saved `unavailable` with reason `timeout`, and the reply did not say it opened. The late-success refusal stays covered by `test/app/open-view.test.ts` ("durable timeout: late rendered ack never changes saved receipt").
