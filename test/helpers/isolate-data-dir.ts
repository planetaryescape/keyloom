// Preloaded before every test file (bunfig.toml). Boards the person derived live in their data directory (22), and commands read them
// at start-up, so a test that forgot `--data-dir` must not find the developer's own.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "keyloom-test-data-"));
// The tools keyloom downloads on a Mac without Homebrew (D-560, D-561) live outside the data directory, so they get their own scratch folder:
// no test finds, or writes, the person's own kanata or Zapp copy.
process.env.KEYLOOM_TOOLS_DIR = mkdtempSync(join(tmpdir(), "keyloom-test-tools-"));
