import { describe, expect, test } from "bun:test";
import { applyRepeat, repeatTransform } from "../../src/layout/repeat.ts";
import type { Binding } from "../../src/layout/schema.ts";

const key = (code: string): Binding => ({ kind: "key", code });
const hold = (tap: string, mods: ("LALT" | "LGUI")[], profileId = "hrm"): Binding => ({ kind: "holdTap", tap: { code: tap }, hold: { mods }, profileId });

describe("repeatTransform", () => {
  test("putting a hold on a key is a rewrap", () => {
    expect(repeatTransform(key("S"), hold("S", ["LALT"]))).toEqual({ kind: "rewrap", hold: { mods: ["LALT"] }, profileId: "hrm" });
  });
  test("changing only the hold of a hold-tap is a rewrap too", () => {
    expect(repeatTransform(hold("S", ["LALT"]), hold("S", ["LGUI"], "other"))).toEqual({ kind: "rewrap", hold: { mods: ["LGUI"] }, profileId: "other" });
  });
  test("taking the hold off is an unwrap", () => {
    expect(repeatTransform(hold("S", ["LALT"]), key("S"))).toEqual({ kind: "unwrap" });
  });
  test("a new tap alongside a hold is not a rewrap, so the exact binding is copied", () => {
    expect(repeatTransform(key("S"), hold("A", ["LALT"]))).toEqual({ kind: "copy", binding: hold("A", ["LALT"]) });
  });
  test("any other edit copies the binding", () => {
    expect(repeatTransform(key("S"), key("ESCAPE"))).toEqual({ kind: "copy", binding: key("ESCAPE") });
    expect(repeatTransform(hold("S", ["LALT"]), { kind: "none" })).toEqual({ kind: "copy", binding: { kind: "none" } });
  });
  test("an edit that changed nothing has nothing to repeat", () => {
    expect(repeatTransform(key("S"), key("S"))).toBeNull();
  });
});

describe("applyRepeat", () => {
  const rewrap = repeatTransform(key("S"), hold("S", ["LALT"]))!;
  test("rewrap gives each key the hold and keeps its own letter", () => {
    expect(applyRepeat(rewrap, key("D"))).toEqual({ binding: hold("D", ["LALT"]) });
    expect(applyRepeat(rewrap, hold("K", ["LGUI"]))).toEqual({ binding: hold("K", ["LALT"]) });
  });
  test("a key that already has it is unchanged", () => {
    expect(applyRepeat(rewrap, hold("D", ["LALT"]))).toEqual({ unchanged: true });
  });
  test("a key with no letter of its own is skipped with a reason", () => {
    expect(applyRepeat(rewrap, { kind: "transparent" })).toEqual({ skip: expect.stringContaining("no key of its own") });
  });
  test("unwrap strips a hold, leaves a plain key and ignores the rest", () => {
    const unwrap = repeatTransform(hold("S", ["LALT"]), key("S"))!;
    expect(applyRepeat(unwrap, hold("D", ["LGUI"]))).toEqual({ binding: key("D") });
    expect(applyRepeat(unwrap, key("D"))).toEqual({ unchanged: true });
    expect(applyRepeat(unwrap, { kind: "none" })).toEqual({ unchanged: true });
  });
  test("copy sets the exact binding", () => {
    const copy = repeatTransform(key("S"), key("ESCAPE"))!;
    expect(applyRepeat(copy, key("D"))).toEqual({ binding: key("ESCAPE") });
    expect(applyRepeat(copy, key("ESCAPE"))).toEqual({ unchanged: true });
  });
});
