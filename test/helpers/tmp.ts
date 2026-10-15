import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "bun:test";

const made: string[] = [];

/** A fresh directory, removed when the test file finishes. */
export function tempDir(prefix = "keyloom-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

// Outside the test runner (the demo servers import these helpers) there is no afterAll, and the OS cleans the temp directory.
try {
  afterAll(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });
} catch {
  // not under bun test
}
