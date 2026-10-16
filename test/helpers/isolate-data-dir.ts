// Preloaded before every test file (bunfig.toml). Boards the person derived live in their data directory (22), and commands read them
// at start-up, so a test that forgot `--data-dir` must not find the developer's own.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "keyloom-test-data-"));
