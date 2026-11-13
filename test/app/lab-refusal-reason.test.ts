// R10-12 (PR #313 review): a lab fix the validator refused keeps the validator's words for the person (`plain`, D-101), not its CLI message.
import { expect, test } from "bun:test";
import { ValidationFailedError } from "../../src/app/errors.ts";
import { firstErrorOf } from "../../src/app/lab.ts";

const refused = (errors: unknown[]) => new ValidationFailedError("1 validation error: x", { ok: false, errors, warnings: [] });

test("the reason is the first error's plain words, else its message, else nothing", () => {
  expect(firstErrorOf(refused([{ code: "c", message: "key 4 on layer-0", plain: "Key 5 on Base" }]))).toBe("Key 5 on Base");
  expect(firstErrorOf(refused([{ code: "c", message: "key 4 on layer-0" }]))).toBe("key 4 on layer-0");
  expect(firstErrorOf(refused([]))).toBeNull();
  expect(firstErrorOf(new ValidationFailedError("no result", null))).toBeNull();
});
