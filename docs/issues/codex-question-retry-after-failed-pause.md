# Codex cannot ask again after it reports a question failed

Status: fixed in `8d4439ee` (D-610). A call that arrives while a question is unreported waits up to one second for Codex's report. A failed report releases the question, so the corrected call runs.

The `ask_user` handler can succeed and Codex can then report that call as failed. keyloom keeps the turn paused, so a corrected `ask_user` in the same run is refused with "keyloom is waiting for an answer; this tool was not run". The person gets Codex's closing reply and no question. They can ask again in the next message.

Observed with the fake Codex on `971c55fc`. The steps were a question reported as failed, a valid retry, then a closing message. The result was `status: "complete"`, `question: null`, and an error result for the retry. No live Codex run has shown this sequence.

Clearing the pause on any failed `ask_user` completion is not safe. Codex can report a completion after the next call has run, so an earlier failed question can clear the pause that a later valid question set. With that change, two tests in `test/agent/codex-pause-order.test.ts` fail: "a buffered failed question completion cannot claim the later valid question's pause" and "a buffered Codex-reported failure with valid arguments cannot replace the successful question". Both end `complete` and lose the valid question.

A fix must match each failed completion to the call that set the pause. The MCP handler does not receive Codex's item id, so that match needs its own design.
