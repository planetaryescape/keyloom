import { dirname, isAbsolute } from "node:path";
import { HelperFailure } from "./errors.ts";

/** Dedicated boundary mocked by the test preload. No shell, PATH lookup or inherited credentials. */
export function launchHelper(path: string) {
  if (!isAbsolute(path)) throw new HelperFailure("helper_unavailable");
  return Bun.spawn([path, "--stdio"], {
    cwd: dirname(path), env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
}
export type HelperChild = ReturnType<typeof launchHelper>;
