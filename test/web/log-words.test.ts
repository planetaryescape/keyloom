// R8-09: "The details are in keyloom's log." comes with a way to read the log.
import { expect, test } from "bun:test";
import { LOG_FILE_WORDS, SHOW_LOG_LABEL, TERMINAL_LOG_WORDS, logWay } from "../../src/web/shell/log-words.ts";
import { INTERNAL_WORDS, NOT_FOUND_WORDS } from "../../src/web/shell/unexpected.ts";

test("in the desktop app the log opens with a button, as the app's own problem window does", () => {
  expect(logWay({ kind: "file", path: "/L/keyloom.log", canShow: true }, true)).toEqual({ show: true, path: null, words: null });
});

test("in a browser the page also gives the file's path to copy", () => {
  expect(logWay({ kind: "file", path: "/L/keyloom.log", canShow: true }, false)).toEqual({ show: true, path: "/L/keyloom.log", words: LOG_FILE_WORDS });
  // Off macOS keyloom can't open it, so only the path is offered.
  expect(logWay({ kind: "file", path: "/L/keyloom.log", canShow: false }, true)).toEqual({ show: false, path: "/L/keyloom.log", words: LOG_FILE_WORDS });
});

test("a keyloom started in a terminal says the log is that terminal; an older keyloom adds nothing", () => {
  expect(logWay({ kind: "terminal" }, false)).toEqual({ show: false, path: null, words: TERMINAL_LOG_WORDS });
  expect(logWay(null, true)).toBeNull();
  expect(SHOW_LOG_LABEL).toBe("Show keyloom's log");
});

test("only an exception's words name the log, so only it gets the way to it", () => {
  expect(INTERNAL_WORDS).toContain("keyloom's log");
  expect(NOT_FOUND_WORDS).not.toContain("log");
});
