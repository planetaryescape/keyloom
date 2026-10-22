import { expect, test } from "bun:test";
import { incompleteRecording } from "../../../src/firmware/emulate/trace.ts";

test("recognizes the former counted QMK and ZMK loss warnings", () => {
  const legacyWarnings = [
    "3 report(s) from the keyboard never arrived, so some key events are missing",
    "the keyboard dropped 4 event(s) because it could not send them fast enough",
    "the keyboard dropped 2 event(s) because the port was read too slowly",
    "the keyboard ended the stream early: the keyboard stopped the stream",
  ];

  for (const warning of legacyWarnings) expect(incompleteRecording([warning])).toBe(true);
});

test("does not classify unrelated warnings or malformed legacy loss wording as incomplete", () => {
  expect(incompleteRecording(["the keyboard connected successfully"])).toBe(false);
  expect(incompleteRecording(["3 reports from the keyboard never arrived"])).toBe(false);
  expect(incompleteRecording(["the keyboard dropped many events"])).toBe(false);
  expect(incompleteRecording(["the keyboard ended the stream normally"])).toBe(false);
});
