// Preloaded before every test file (bunfig.toml). A test that forgets its fake zapp must hit this
// refusal, never the real one: a real flash rewrites the keyboard BK types on.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "keyloom-no-flash-"));
mkdirSync(dir, { recursive: true });
const zapp = join(dir, "zapp");
writeFileSync(zapp, '#!/bin/sh\necho "the real zapp is blocked in tests; pass a fake" >&2\nexit 97\n');
chmodSync(zapp, 0o755);
process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
