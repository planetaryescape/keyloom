// Numbered SQL migrations (02). The files are imported as text so `bun build --compile`
// embeds them; a migration is added by adding the file and one line here.
import m0001 from "./migrations/0001_layouts_and_revisions.sql" with { type: "text" };
import m0002 from "./migrations/0002_change_sets.sql" with { type: "text" };
import m0003 from "./migrations/0003_builds_and_flashes.sql" with { type: "text" };
import m0004 from "./migrations/0004_conversations_and_messages.sql" with { type: "text" };
import m0005 from "./migrations/0005_decisions.sql" with { type: "text" };
import m0006 from "./migrations/0006_decision_lifecycle.sql" with { type: "text" };
import m0007 from "./migrations/0007_conversation_provider.sql" with { type: "text" };
import m0008 from "./migrations/0008_keyboard_sync.sql" with { type: "text" };
import m0009 from "./migrations/0009_typing_sessions.sql" with { type: "text" };

export const MIGRATIONS: ReadonlyArray<{ version: number; name: string; sql: string }> = [
  { version: 1, name: "0001_layouts_and_revisions", sql: m0001 },
  { version: 2, name: "0002_change_sets", sql: m0002 },
  { version: 3, name: "0003_builds_and_flashes", sql: m0003 },
  { version: 4, name: "0004_conversations_and_messages", sql: m0004 },
  { version: 5, name: "0005_decisions", sql: m0005 },
  { version: 6, name: "0006_decision_lifecycle", sql: m0006 },
  { version: 7, name: "0007_conversation_provider", sql: m0007 },
  { version: 8, name: "0008_keyboard_sync", sql: m0008 },
  { version: 9, name: "0009_typing_sessions", sql: m0009 },
];
