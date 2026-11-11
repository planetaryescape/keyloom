// The QMK and ZMK search says when it found nothing (R4-12), instead of a blank list.
import { expect, test } from "bun:test";
import { searchNote } from "../../src/web/keyboards/search-words.ts";

test("a search says too short, searching, or none, and stays out of the way of results and failures", () => {
  expect(searchNote("a", null, 0, false)).toBe("too_short");
  expect(searchNote("crkbd", null, 0, false)).toBe("searching");
  // Results for an earlier text don't answer this one.
  expect(searchNote("crkbd", "crk", 3, false)).toBe("searching");
  expect(searchNote(" crkbd ", "crkbd", 0, false)).toBe("none");
  expect(searchNote("crkbd", "crkbd", 2, false)).toBeNull();
  // A failed search has its own alert.
  expect(searchNote("crkbd", null, 0, true)).toBeNull();
});
