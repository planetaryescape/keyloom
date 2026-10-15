// Numbered SQL migrations (02). The files are imported as text so `bun build --compile`
// embeds them; a migration is added by adding the file and one line here.
import m0001 from "./migrations/0001_layouts_and_revisions.sql" with { type: "text" };
import m0002 from "./migrations/0002_change_sets.sql" with { type: "text" };
import m0003 from "./migrations/0003_builds_and_flashes.sql" with { type: "text" };

export const MIGRATIONS: ReadonlyArray<{ version: number; name: string; sql: string }> = [
  { version: 1, name: "0001_layouts_and_revisions", sql: m0001 },
  { version: 2, name: "0002_change_sets", sql: m0002 },
  { version: 3, name: "0003_builds_and_flashes", sql: m0003 },
];
