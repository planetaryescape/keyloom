// R5-17: a refused copy says so and names the key that finishes it, since the command is left selected.
import { expect, test } from "bun:test";
import { copyFailedWords } from "../../src/web/shell/CopyCommand.tsx";

test("a refused copy names the copy key for the platform", () => {
  expect(copyFailedWords(true)).toBe("keyloom couldn't copy it. The command is selected: press ⌘C to copy it.");
  expect(copyFailedWords(false)).toContain("Ctrl+C");
});
