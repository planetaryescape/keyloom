# 08: Decision memory

keyloom remembers why each key is where it is, so a later change can bring up a reason BK has forgotten (D-022). In BK's words: "if later I want to come back and replace something that I previously said was important, it will know that this thing is important because of this reason, even if I have forgotten that reason."

## What a decision holds

A decision is one of two kinds:

- **`choice`:** something keyloom changed for a reason. It's written when a change set is applied.
- **`priority`:** something BK said about what matters, such as "keep Backspace where it is", "I barely use Caps Lock" or "I'm willing to relearn these two keys" (D-021). The agent writes it through `record_priority` ([03](03-agent.md#tools)).

Each one carries what the planning session listed (D-023):

- the goal or frustration it answers
- what was chosen, and why
- its scope: the keyboard, the apps and the habits it applies to
- its outcome, meaning whether BK tried it and it helped

```sql
decisions(
  id TEXT PRIMARY KEY,                 -- dec_…
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  kind TEXT NOT NULL CHECK (kind IN ('choice','priority')),
  priority_kind TEXT NULL CHECK (priority_kind IN ('pinned','rarely_used','frequent','willing_to_relearn')),
  subject TEXT NOT NULL,               -- JSON: { slots?: Slot[], functions?: string[] }
  goal TEXT NOT NULL,                  -- "Option–Option shortcuts were impossible"
  choice TEXT NOT NULL,                -- "S is plain Option on the symbol layer"
  reason TEXT NOT NULL,
  scope TEXT NOT NULL,                 -- JSON: { apps: string[], habits: string[] }
  status TEXT NOT NULL CHECK (status IN ('hypothesis','tried_helpful','tried_unhelpful','superseded','retired')),
  outcome_note TEXT NULL,
  change_set_id TEXT NULL REFERENCES change_sets(id),
  conversation_id TEXT NULL REFERENCES conversations(id),
  source_message_ids TEXT NOT NULL,    -- JSON array of msg_ IDs: the link back (D-023)
  superseded_by TEXT NULL REFERENCES decisions(id),
  status_before TEXT NULL,             -- the status to restore if the change that took this out of play is reversed (D-054)
  outcome_asked_at INTEGER NULL,       -- when the 7-day question was answered or dismissed (D-056)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX decisions_layout ON decisions(layout_id, status);
```

`subject` holds both slots and functions, because a reason can be about a place ("this thumb key") or a thing ("Command–Shift").

## How decisions are written

- **On apply.** Each proposal carries a `decisionDraft` (`goal`, `choice`, `reason`, `scope`) that the agent writes from the conversation. On apply it becomes a `choice` decision with `status = 'hypothesis'`. Its `subject` comes from the validator's `diff`. BK can edit the text in the decisions view before or after.
- **Editor-only changes** get a decision only if BK types a reason in the apply dialog. The field is optional, because a typo fix needs no memory.
- **Priorities** are written by the agent as BK states them. `goal` holds BK's statement as he said it ("keep Backspace where it is"), `choice` the priority kind in words, and `reason` his reason if he gave one, otherwise "stated by BK". They appear as a chip in the chat ("Remembered: Backspace stays where it is") with a remove action, so a misheard priority is one click to undo.

## How decisions come back

The retrieval is deterministic, with no embeddings or search index. One layout has tens of decisions, not thousands.

1. **All active decisions are in the agent's context** ([03](03-agent.md#what-the-agent-sees)), and they're short. The agent can mention them in conversation: "You put Command–Shift there because the two home-row mods together were uncomfortable in your editor shortcuts. Do you still use those?"
2. **The validator attaches reminders.** A change set whose `diff.changed` or `diff.displaced` overlaps an active decision's `subject` gets a `DecisionReminder { decisionId, goal, reason, status }` and a `contradicts_decision` or `moved_pinned` warning ([07](07-change-validation.md#warnings)). The preview shows the reason beside the affected keys.
3. **A reminder never blocks** (D-023). If BK applies the change anyway, the old decision becomes `superseded` with `superseded_by` set to the new one. That way the history of why it moved is kept too. A change applied with no reason has no new decision to point at, so what it overrode is superseded with `superseded_by` null (D-054).

Only `choice` decisions raise reminders, and not one BK marked `tried_unhelpful` (D-053). The agent is told to quote the reason and ask whether it still holds before it proposes (D-055).

## Undo and redo

A decision describes a document, so it follows the document. Undoing a revision retires the decisions its change set wrote and puts back, with the status they had, the ones it superseded. Undoing the undo reverses both. `decisions.status_before` holds the status to return to, and is empty for a decision BK retired himself, which nothing restores (D-054).

## Tried outweighs hypothesised

"We thought this would be comfortable" and "you used this for a month and liked it" carry different weight (D-018, D-023):

- The agent's prompt renders each decision with its status. It's instructed that `tried_helpful` decisions need a stated reason before it proposes undoing them, and that `hypothesis` decisions are open to revision.
- **Asking about outcomes.** A `hypothesis` decision is due 7 days after the first successful flash whose build began after it was applied. The chat panel then asks once: "Has plain Option on the symbol layer worked out?" He answers "It helped" or "It didn't help" with a note, or "Not now", which ends the question and leaves the decision a hypothesis. `outcome_asked_at` records that it was asked. The agent's `update_decision_outcome` records the same verdicts, and `keyloom decisions due` lists what is due. The 7 days is an assumption (Q6, D-056).
- BK's unprompted feedback ("that feels slow now") does the same in any conversation.

## Inspecting and correcting

BK can inspect and correct everything keyloom remembers (D-023):

- The web app has a decisions view per layout, in the chat panel (D-059). It lists each decision with its status, and the keys are highlighted when one is hovered. Each decision links to the conversation it came from.
- He can edit the goal, choice, reason and scope, change the status, or retire a decision (`status = 'retired'`), which takes it out of the agent's context.
- `keyloom decisions list|show|edit|retire` does the same from the CLI ([10](10-cli.md)).
