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
3. **A reminder never blocks** (D-023). If BK applies the change anyway, the old decision becomes `superseded` with `superseded_by` set to the new one. That way the history of why it moved is kept too.

## Tried outweighs hypothesised

"We thought this would be comfortable" and "you used this for a month and liked it" carry different weight (D-018, D-023):

- The agent's prompt renders each decision with its status. It's instructed that `tried_helpful` decisions need a stated reason before it proposes undoing them, and that `hypothesis` decisions are open to revision.
- **Asking about outcomes.** When BK opens a layout at least 7 days after a flash, keyloom asks once in the chat about each `hypothesis` decision applied before that flash: "Has plain Option on the symbol layer worked out?" The answer updates the status through `update_decision_outcome`. The 7 days is an assumption (Q6).
- BK's unprompted feedback ("that feels slow now") does the same in any conversation.

## Inspecting and correcting

BK can inspect and correct everything keyloom remembers (D-023):

- The web app has a decisions view per layout. It lists each decision with its status, and the keys are highlighted when one is hovered. Each decision links to the conversation messages it came from.
- He can edit the goal, choice, reason and scope, change the status, or retire a decision (`status = 'retired'`), which takes it out of the agent's context.
- `keyloom decisions list|show|edit|retire` does the same from the CLI ([10](10-cli.md)).
