import { describe, expect, test } from "bun:test";
import { deepEqual } from "../../src/layout/equal.ts";

describe("deepEqual", () => {
  test("compares objects regardless of key order, and arrays by order", () => {
    expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });

  test("an absent field equals an undefined one; null and undefined differ", () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: null }, { a: undefined })).toBe(false);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual({}, [])).toBe(false);
    expect(deepEqual(1, "1")).toBe(false);
  });
});
