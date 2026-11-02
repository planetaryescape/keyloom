# Review read and action errors share a presentation channel

Status: open, P3 presentation follow-up. Identified during [PR 230 review](https://github.com/planetaryescape/keyloom/pull/230#discussion_r4437946829) against `a0b77f1d`; explicitly deferred from the v0.68.2 shipping gate. The narrow overlap below has not been independently reproduced in a browser.

`useReview` stores GET failures and POST action failures in the same `problem` field. `ReviewPanel` uses that field to choose the generic **Review unavailable** state while a replacement is still locked. An action failure overlapping a new event/read could therefore briefly use the read-failure presentation even though it was the POST that failed.

The generation guard rejects a superseded POST result once the replacement GET has started. The original error text remains visible. **Try loading again** performs only GET: this presentation ambiguity does not unlock stale findings, approve Apply or start another provider call.

## Next check

Extend `test/web/review-loading.fixture.tsx` to hold a POST rejection across the matching review event and the start of its replacement GET. Establish whether the visible overlap survives a React commit. If it does, separate read and action errors in the hook and make the failed-read state depend only on the read channel.

Keep the existing failed-GET lock, foreign-event isolation, read-only retry and dismissal-draft assertions. Do not broaden retries into model reruns or change review scheduling to fix error wording.
